package model

import "testing"

func TestPlaceOpenAt(t *testing.T) {
	day := Place{OpensAt: 480, ClosesAt: 1320}   // 08:00–22:00
	night := Place{OpensAt: 720, ClosesAt: 1500} // 12:00–01:00
	cases := []struct {
		name string
		p    Place
		at   int
		want bool
	}{
		{"до открытия", day, 479, false},
		{"открытие", day, 480, true},
		{"закрытие — уже закрыто", day, 1320, false},
		{"после полуночи, место работает", night, 30, true},
		{"после полуночи, закрылось", night, 60, false},
		{"утром до открытия", night, 600, false},
		{"вечером", night, 1400, true},
	}
	for _, c := range cases {
		if got := c.p.OpenAt(c.at); got != c.want {
			t.Errorf("%s: OpenAt(%d) = %v, ожидали %v", c.name, c.at, got, c.want)
		}
	}
}
