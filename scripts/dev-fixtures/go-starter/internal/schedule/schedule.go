// Package schedule computes maintenance windows for a fleet of machines.
package schedule

import (
	"errors"
	"time"
)

// ErrEmptyFleet is returned when a window is requested for no machines.
var ErrEmptyFleet = errors.New("schedule: fleet is empty")

// Machine is one host that can be taken offline for maintenance.
type Machine struct {
	Name string
	// LoadPercent is the machine's current utilisation, 0-100.
	LoadPercent int
}

// Window is a maintenance slot assigned to a machine.
type Window struct {
	Machine string
	Start   time.Time
	End     time.Time
}

// PlanWindows assigns each machine a non-overlapping maintenance window of the given duration,
// starting at `from`, ordered least-loaded first so the busiest machines are disturbed last.
func PlanWindows(fleet []Machine, from time.Time, each time.Duration) ([]Window, error) {
	if len(fleet) == 0 {
		return nil, ErrEmptyFleet
	}
	ordered := make([]Machine, len(fleet))
	copy(ordered, fleet)
	// Simple insertion sort by LoadPercent ascending — the fleet is small by construction.
	for i := 1; i < len(ordered); i++ {
		for j := i; j > 0 && ordered[j].LoadPercent < ordered[j-1].LoadPercent; j-- {
			ordered[j], ordered[j-1] = ordered[j-1], ordered[j]
		}
	}

	windows := make([]Window, 0, len(ordered))
	cursor := from
	for _, machine := range ordered {
		windows = append(windows, Window{
			Machine: machine.Name,
			Start:   cursor,
			End:     cursor.Add(each),
		})
		cursor = cursor.Add(each)
	}
	return windows, nil
}
