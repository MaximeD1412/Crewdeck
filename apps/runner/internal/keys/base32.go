package keys

import (
	"errors"
	"strings"
)

// Crockford's base32 (https://www.crockford.com/base32.html), as the link and
// Appareil codes use it: no padding, no check symbol, the bits read from the
// most significant one, the last symbol padded with zero bits.
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

var errBase32 = errors.New("keys: not a Crockford base32 string")

// EncodeBase32 encodes in upper case.
func EncodeBase32(b []byte) string {
	var s strings.Builder
	var acc, bits uint
	for _, c := range b {
		acc = acc<<8 | uint(c)
		bits += 8
		for bits >= 5 {
			bits -= 5
			s.WriteByte(crockford[acc>>bits&31])
		}
	}
	if bits > 0 {
		s.WriteByte(crockford[acc<<(5-bits)&31])
	}
	return s.String()
}

// symbol maps a character to its value: either case, I and L read as 1, O as
// 0; U and anything else (hyphens included) is refused.
func symbol(c byte) (uint, bool) {
	if c >= 'a' && c <= 'z' {
		c -= 'a' - 'A'
	}
	switch c {
	case 'I', 'L':
		return 1, true
	case 'O':
		return 0, true
	}
	if i := strings.IndexByte(crockford, c); i >= 0 {
		return uint(i), true
	}
	return 0, false
}

// DecodeBase32 decodes what EncodeBase32 gives, in either case and with
// Crockford's aliases. A length no encoding gives, or non-zero padding bits,
// is refused, so that one byte string has a single spelling up to the aliases.
func DecodeBase32(s string) ([]byte, error) {
	if r := len(s) % 8; r == 1 || r == 3 || r == 6 {
		return nil, errBase32
	}
	out := make([]byte, 0, len(s)*5/8)
	var acc, bits uint
	for i := 0; i < len(s); i++ {
		v, ok := symbol(s[i])
		if !ok {
			return nil, errBase32
		}
		acc = acc<<5 | v
		bits += 5
		if bits >= 8 {
			bits -= 8
			out = append(out, byte(acc>>bits))
		}
	}
	if acc&(1<<bits-1) != 0 {
		return nil, errBase32
	}
	return out, nil
}
