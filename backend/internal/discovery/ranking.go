package discovery

import (
	"strings"

	"github.com/auradating/platform/backend/internal/identity"
)

// CalculateRelevanceScore evaluates multi-dimensional LGBTQ+ compatibility, shared intentions,
// and proximity suitability. The score normalizes between 0.0 and 100.0 and is used strictly for
// candidate ordering within the eligible, safety-filtered candidate pool.
func CalculateRelevanceScore(
	actorProf *identity.Profile,
	actorPref *identity.DatingPreferences,
	targetProf *identity.Profile,
	distanceKm float64,
) float64 {
	var score float64

	// 1. Relationship Intentions Alignment (Max 35 points)
	if len(actorProf.RelationshipIntents) > 0 && len(targetProf.RelationshipIntents) > 0 {
		actorIntents := make(map[string]struct{}, len(actorProf.RelationshipIntents))
		for _, i := range actorProf.RelationshipIntents {
			actorIntents[strings.ToLower(strings.TrimSpace(i))] = struct{}{}
		}
		var sharedIntents int
		for _, i := range targetProf.RelationshipIntents {
			if _, ok := actorIntents[strings.ToLower(strings.TrimSpace(i))]; ok {
				sharedIntents++
			}
		}
		if sharedIntents > 0 {
			// Up to 35 points based on intent overlap
			score += float64(sharedIntents) * 17.5
			if score > 35.0 {
				score = 35.0
			}
		}
	}

	// 2. Relationship Structure Alignment (Max 20 points)
	if actorProf.RelationshipStructure != "" && targetProf.RelationshipStructure != "" {
		if actorProf.RelationshipStructure == targetProf.RelationshipStructure {
			score += 20.0
		} else if actorProf.RelationshipStructure == identity.StructureExploring || targetProf.RelationshipStructure == identity.StructureExploring {
			score += 10.0
		}
	}

	// 3. Sexual Orientation Spectrum Alignment (Max 20 points)
	if len(actorProf.SexualOrientations) > 0 && len(targetProf.SexualOrientations) > 0 {
		actorOris := make(map[string]struct{}, len(actorProf.SexualOrientations))
		for _, o := range actorProf.SexualOrientations {
			actorOris[strings.ToLower(strings.TrimSpace(o))] = struct{}{}
		}
		var sharedOris int
		for _, o := range targetProf.SexualOrientations {
			if _, ok := actorOris[strings.ToLower(strings.TrimSpace(o))]; ok {
				sharedOris++
			}
		}
		if sharedOris > 0 {
			score += 20.0
		} else {
			score += 5.0 // General community overlap
		}
	}

	// 4. Proximity Suitability Gradient (Max 15 points)
	maxDist := float64(actorPref.MaxDistanceKm)
	if maxDist <= 0 {
		maxDist = 50.0
	}
	if distanceKm <= maxDist {
		// Linear decay from 15 points (at 0 km) down to 2 points (at max distance)
		distRatio := distanceKm / maxDist
		score += 15.0 - (distRatio * 13.0)
	}

	// 5. Photo Verification Trust Bonus (Max 10 points)
	if targetProf.IsPhotoVerified {
		score += 10.0
	}

	if score > 100.0 {
		score = 100.0
	}
	if score < 0.0 {
		score = 0.0
	}

	return score
}

// CalculateBoostedScore multiplies base relevance score with an active profile boost multiplier.
// Boost only promotes candidate ordering within the eligible pool; it NEVER bypasses reciprocal
// age boundaries, sexual orientation overlap, max distance, incognito mode, or safety blocks.
func CalculateBoostedScore(baseScore float64, multiplier float64) float64 {
	if multiplier <= 1.0 {
		return baseScore
	}
	boosted := baseScore * multiplier
	if boosted > 1000.0 {
		boosted = 1000.0
	}
	return boosted
}
