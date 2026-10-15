package migrations

import "embed"

// FS embeds all versioned SQL migration files (*.up.sql and *.down.sql)
// into the Go binary so migrations can run deterministically without
// external file-path dependencies.
//
//go:embed *.sql
var FS embed.FS
