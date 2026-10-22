package media

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidPath      = errors.New("invalid or unauthorized storage path")
	ErrFileNotFound     = errors.New("media file not found")
	ErrSignatureInvalid = errors.New("invalid or expired media access token")
)

// StorageEngine defines the abstract interface for media quarantine and derivative persistence.
type StorageEngine interface {
	SaveQuarantine(ctx context.Context, key string, data io.Reader, size int64) error
	OpenQuarantine(ctx context.Context, key string) (io.ReadCloser, error)
	DeleteQuarantine(ctx context.Context, key string) error

	SaveDerivative(ctx context.Context, bucket, key string, data io.Reader, size int64, mimeType string) error
	OpenDerivative(ctx context.Context, bucket, key string) (ReadSeekCloser, string, int64, error)
	DeleteDerivative(ctx context.Context, bucket, key string) error
	DeleteAssetFiles(ctx context.Context, assetID string) error

	GenerateSignedToken(bucket, key string, ttl time.Duration) (string, time.Time)
	VerifySignedToken(bucket, key, token string) bool
}

// ReadSeekCloser combines io.ReadSeeker and io.Closer for HTTP range serving.
type ReadSeekCloser interface {
	io.ReadSeeker
	io.Closer
}

// FileStorageEngine implements StorageEngine using local disk storage with strict path sanitization
// and HMAC-SHA256 signed access tokens.
type FileStorageEngine struct {
	baseDir    string
	signingKey []byte
}

func NewFileStorageEngine(baseDir string, signingSecret string) (*FileStorageEngine, error) {
	if strings.TrimSpace(baseDir) == "" {
		baseDir = "data/media"
	}
	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve absolute path for media directory: %w", err)
	}

	quarantineDir := filepath.Join(absBase, "quarantine")
	derivativesDir := filepath.Join(absBase, "derivatives")

	if err := os.MkdirAll(quarantineDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create quarantine directory %s: %w", quarantineDir, err)
	}
	if err := os.MkdirAll(derivativesDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create derivatives directory %s: %w", derivativesDir, err)
	}

	key := []byte(strings.TrimSpace(signingSecret))
	if len(key) == 0 {
		env := strings.ToLower(strings.TrimSpace(os.Getenv("ENV")))
		if env == "production" || env == "staging" {
			return nil, errors.New("media token signing secret is required in production/staging")
		}
		key = []byte("default-aura-media-token-signing-secret-key-32b")
	}

	return &FileStorageEngine{
		baseDir:    absBase,
		signingKey: key,
	}, nil
}

func (f *FileStorageEngine) resolveSafePath(subDir, key string) (string, error) {
	if strings.Contains(key, "..") || strings.Contains(key, "\x00") || strings.Contains(key, "\\") ||
		strings.HasPrefix(key, "/") || filepath.IsAbs(key) {
		return "", ErrInvalidPath
	}
	cleanedKey := filepath.Clean(key)
	if strings.HasPrefix(cleanedKey, "/") || strings.HasPrefix(cleanedKey, "\\") || strings.HasPrefix(cleanedKey, "..") || filepath.IsAbs(cleanedKey) {
		return "", ErrInvalidPath
	}

	targetDir := filepath.Join(f.baseDir, subDir)
	fullPath := filepath.Join(targetDir, cleanedKey)

	// Ensure fullPath is strictly inside targetDir
	rel, err := filepath.Rel(targetDir, fullPath)
	if err != nil || strings.HasPrefix(rel, "..") || strings.HasPrefix(rel, "/") {
		return "", ErrInvalidPath
	}

	return fullPath, nil
}

func (f *FileStorageEngine) SaveQuarantine(ctx context.Context, key string, data io.Reader, size int64) error {
	fullPath, err := f.resolveSafePath("quarantine", key)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(fullPath), 0700); err != nil {
		return fmt.Errorf("failed to create quarantine dir: %w", err)
	}

	file, err := os.OpenFile(fullPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("failed to create quarantine file: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, data); err != nil {
		_ = os.Remove(fullPath)
		return fmt.Errorf("failed to write quarantine data: %w", err)
	}
	return nil
}

func (f *FileStorageEngine) OpenQuarantine(ctx context.Context, key string) (io.ReadCloser, error) {
	fullPath, err := f.resolveSafePath("quarantine", key)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrFileNotFound
		}
		return nil, err
	}
	return file, nil
}

func (f *FileStorageEngine) DeleteQuarantine(ctx context.Context, key string) error {
	fullPath, err := f.resolveSafePath("quarantine", key)
	if err != nil {
		return err
	}
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (f *FileStorageEngine) SaveDerivative(ctx context.Context, bucket, key string, data io.Reader, size int64, mimeType string) error {
	fullPath, err := f.resolveSafePath(filepath.Join("derivatives", bucket), key)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(fullPath), 0700); err != nil {
		return fmt.Errorf("failed to create derivatives dir: %w", err)
	}

	file, err := os.OpenFile(fullPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("failed to create derivative file: %w", err)
	}
	defer file.Close()

	if _, err := io.Copy(file, data); err != nil {
		_ = os.Remove(fullPath)
		return fmt.Errorf("failed to write derivative file: %w", err)
	}
	return nil
}

func (f *FileStorageEngine) OpenDerivative(ctx context.Context, bucket, key string) (ReadSeekCloser, string, int64, error) {
	fullPath, err := f.resolveSafePath(filepath.Join("derivatives", bucket), key)
	if err != nil {
		return nil, "", 0, err
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", 0, ErrFileNotFound
		}
		return nil, "", 0, err
	}

	file, err := os.Open(fullPath)
	if err != nil {
		return nil, "", 0, err
	}

	// Sniff or infer MIME
	mime := "application/octet-stream"
	ext := strings.ToLower(filepath.Ext(key))
	switch ext {
	case ".webp":
		mime = "image/webp"
	case ".jpg", ".jpeg":
		mime = "image/jpeg"
	case ".png":
		mime = "image/png"
	case ".avif":
		mime = "image/avif"
	case ".mp4":
		mime = "video/mp4"
	case ".webm":
		mime = "video/webm"
	case ".m3u8":
		mime = "application/vnd.apple.mpegurl"
	case ".m4s":
		mime = "video/iso.segment"
	}

	return file, mime, info.Size(), nil
}

func (f *FileStorageEngine) DeleteDerivative(ctx context.Context, bucket, key string) error {
	fullPath, err := f.resolveSafePath(filepath.Join("derivatives", bucket), key)
	if err != nil {
		return err
	}
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (f *FileStorageEngine) DeleteAssetFiles(ctx context.Context, assetID string) error {
	if strings.TrimSpace(assetID) == "" {
		return errors.New("assetID cannot be blank")
	}

	var firstErr error

	// 1. Remove quarantine files matching assetID
	quarantineDir := filepath.Join(f.baseDir, "quarantine")
	if _, err := os.Stat(quarantineDir); err == nil {
		_ = filepath.Walk(quarantineDir, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if !info.IsDir() && strings.Contains(filepath.Base(path), assetID) {
				if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
					if firstErr == nil {
						firstErr = err
					}
				}
			}
			return nil
		})
	}

	// 2. Remove derivative directories and files matching assetID
	derivativesDir := filepath.Join(f.baseDir, "derivatives")
	if _, err := os.Stat(derivativesDir); err == nil {
		_ = filepath.Walk(derivativesDir, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if info.IsDir() && filepath.Base(path) == assetID {
				if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
					if firstErr == nil {
						firstErr = err
					}
				}
				return filepath.SkipDir
			}
			if !info.IsDir() && strings.Contains(path, assetID) {
				if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
					if firstErr == nil {
						firstErr = err
					}
				}
			}
			return nil
		})
	}

	return firstErr
}


func (f *FileStorageEngine) GenerateSignedToken(bucket, key string, ttl time.Duration) (string, time.Time) {
	exp := time.Now().Add(ttl).UTC()
	expStr := strconv.FormatInt(exp.Unix(), 10)
	target := fmt.Sprintf("%s/%s:%s", bucket, key, expStr)

	mac := hmac.New(sha256.New, f.signingKey)
	mac.Write([]byte(target))
	sig := hex.EncodeToString(mac.Sum(nil))

	token := fmt.Sprintf("%s.%s", sig, expStr)
	return token, exp
}

func (f *FileStorageEngine) VerifySignedToken(bucket, key, token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	sig := parts[0]
	expStr := parts[1]

	expUnix, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return false
	}
	if time.Now().UTC().Unix() > expUnix {
		return false // Expired
	}

	target := fmt.Sprintf("%s/%s:%s", bucket, key, expStr)
	mac := hmac.New(sha256.New, f.signingKey)
	mac.Write([]byte(target))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(sig), []byte(expectedSig))
}
