package schedule

import (
	"errors"
	"testing"
	"time"
)

func TestPlanWindowsRejectsEmptyFleet(t *testing.T) {
	_, err := PlanWindows(nil, time.Now(), time.Hour)
	if !errors.Is(err, ErrEmptyFleet) {
		t.Fatalf("expected ErrEmptyFleet, got %v", err)
	}
}

func TestPlanWindowsOrdersLeastLoadedFirst(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	fleet := []Machine{
		{Name: "busy", LoadPercent: 90},
		{Name: "idle", LoadPercent: 5},
		{Name: "mid", LoadPercent: 50},
	}
	windows, err := PlanWindows(fleet, start, time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"idle", "mid", "busy"}
	for i, name := range want {
		if windows[i].Machine != name {
			t.Fatalf("window %d: want %s, got %s", i, name, windows[i].Machine)
		}
	}
}

func TestPlanWindowsDoNotOverlap(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	fleet := []Machine{{Name: "a", LoadPercent: 1}, {Name: "b", LoadPercent: 2}}
	windows, _ := PlanWindows(fleet, start, 30*time.Minute)
	if windows[1].Start.Before(windows[0].End) {
		t.Fatalf("windows overlap: %v starts before %v ends", windows[1].Start, windows[0].End)
	}
}
