# Courtside

Courtside books the courts of a tennis club: members reserve a slot, the
club's staff run the courts.

## Language

### Booking

**Member** (`Member`):
A person of the club who may book a court.
_Avoid_: user, player

**Booking** (`Reservation`):
One court held for one Member over one slot.
_Avoid_: slot, appointment

**Member** (`ClubMember`):
A person who pays the club's fee.

## Flagged ambiguities

- "court" was used for both the place and its slot; the slot is a **Booking**.
