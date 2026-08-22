package repositories

import (
	"context"
	"errors"
	"testing"

	"github.com/myunivokai/myunivokai/services/ocean-service/internal/models"
)

func TestSelectUnknownVariantPreservesCurrentSelection(t *testing.T) {
	store := NewMemoryStore()
	bundle, err := store.CreateWorld(context.Background(), models.World{SourceJobID: "job-1", Visibility: "private"}, models.WorldVariant{ID: "variant-1", VariantNo: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SelectVariant(context.Background(), bundle.World.ID, "unknown-variant"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("select error = %v, want ErrNotFound", err)
	}
	unchangedBundle, err := store.GetWorld(context.Background(), bundle.World.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(unchangedBundle.Variants) != 1 || !unchangedBundle.Variants[0].IsSelected {
		t.Fatalf("selection changed after failed select: %+v", unchangedBundle.Variants)
	}
	if unchangedBundle.World.SelectedVariantID == nil || *unchangedBundle.World.SelectedVariantID != "variant-1" {
		t.Fatalf("selected variant id changed: %v", unchangedBundle.World.SelectedVariantID)
	}
}
