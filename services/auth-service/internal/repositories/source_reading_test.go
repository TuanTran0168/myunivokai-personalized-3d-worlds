package repositories

import (
	"os"
	"strings"
	"testing"
)

// readRepositorySource and containsAll support the one assertion in this
// package that has to be made against SQL rather than against behaviour:
// PostgresStore needs a live database, so a guard written into its statements
// can only be checked here by reading them.
//
// A source-reading assertion is a weak test and is used deliberately narrowly
// — it says "the guard is still written down", never "the guard works". What
// makes it worth having is the failure it catches: MemoryStore's guard passing
// every unit test while PostgresStore, the only store production runs, has
// lost its own.
func readRepositorySource(t *testing.T, fileName string) string {
	t.Helper()
	contents, err := os.ReadFile(fileName)
	if err != nil {
		t.Fatalf("read %s: %v", fileName, err)
	}
	return string(contents)
}

func containsAll(source string, fragments ...string) bool {
	for _, fragment := range fragments {
		if !strings.Contains(source, fragment) {
			return false
		}
	}
	return true
}
