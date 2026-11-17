// The designer's eye: what an architect or interior designer would raise about a room before it is
// built, written for a homeowner. Each note says what to do and who to ask. A note with `when` shows
// once the conversation about the room touches it (ask for a walk-in shower and the waterproofing,
// floor recess and tempered glass notes appear); the rest are standing advice for that kind of room.
//
// These are prompts for a conversation with the people building it, not code rulings: where a number
// is given it is the common rule of thumb, and the local inspector has the last word.
import type { RoomKind } from './house'

export type Advice = {
  id: string
  rooms: RoomKind[] | 'any'
  when?: RegExp
  title: string
  body: string
  ask: 'designer' | 'architect' | 'engineer' | 'plumber' | 'electrician' | 'contractor'
}

const WET: RoomKind[] = ['bath']
const A = (a: Advice) => a

export const ADVICE: Advice[] = [
  // ------------------------------------------------------------ baths
  A({ id: 'bath-shower-water', rooms: WET, when: /shower|curbless|walk.?in|wet room|rain ?head|steam/i, title: 'A shower is mostly what you cannot see', body: 'Ask how the shower will be waterproofed (a full membrane behind the tile, not just cement board) and ask for a flood test before any tile goes on. The floor should fall about 1/4 inch per foot to the drain. This is where remodels leak.', ask: 'contractor' }),
  A({ id: 'bath-curbless', rooms: WET, when: /curbless|walk.?in|no curb|zero.?(entry|threshold)|wet room|roll.?in/i, title: 'A curbless shower needs the floor lowered', body: 'To have no step, the shower floor has to sit below the bathroom floor, which usually means notching or reframing the joists underneath. On an upper floor that is a question for the structural engineer before the layout is final.', ask: 'engineer' }),
  A({ id: 'bath-controls', rooms: WET, when: /shower|tub|rain ?head|valve|faucet/i, title: 'Put the controls where you can reach them dry', body: 'The valve should be reachable from the shower entry so you can turn the water on without standing under it. Decide now on a handheld sprayer, a bench and a niche: all three are framed and plumbed before tile.', ask: 'plumber' }),
  A({ id: 'bath-glass', rooms: WET, when: /shower|tub|window|glass|door/i, title: 'Glass near water has to be tempered', body: 'Any window within about 5 feet of a tub or shower floor, and all shower glass, must be tempered safety glass. A window inside a shower also needs a sloped, waterproof sill and privacy glass or film.', ask: 'architect' }),
  A({ id: 'bath-tub', rooms: WET, when: /tub|soak|freestanding|jetted|whirlpool|clawfoot/i, title: 'A big tub needs the floor and the hot water to match', body: 'A filled soaking tub with a person in it can weigh well over 800 pounds; on an upper floor have the joists checked. A deep tub can also empty a standard 50 gallon water heater. A jetted tub needs an access panel for its pump, and a freestanding filler is plumbed through the floor before tile.', ask: 'engineer' }),
  A({ id: 'bath-drain', rooms: WET, when: /toilet|move|relocat|swap|other wall|new layout|rearrange|where the/i, title: 'Moving a drain is the expensive part', body: 'A toilet needs a 3 inch drain with steady slope and a vent. Moving one more than a couple of feet, or to another wall, usually means opening the floor or the ceiling below. Have the plumber confirm the route before you fall in love with a layout.', ask: 'plumber' }),
  A({ id: 'bath-vanity', rooms: WET, when: /vanity|sink|faucet|counter|mirror/i, title: 'Check vanity height, width and faucet reach', body: 'Comfort height is 34 to 36 inches. Each sink wants at least 30 inches of counter, 36 is better. A wall-mounted faucet must be set in the wall before tile, and drawers have to clear the drain trap, so pick the vanity and faucet together.', ask: 'designer' }),
  A({ id: 'bath-light-rated', rooms: WET, when: /light|sconce|pendant|chandelier|fixture|lamp/i, title: 'Lights near water have their own rules', body: 'Fixtures in or right beside a shower must be rated for wet or damp locations. A hanging fixture over or near a tub generally has to be 8 feet above the rim or 3 feet to the side, which rules out most chandeliers over tubs.', ask: 'electrician' }),
  A({ id: 'bath-fan', rooms: WET, title: 'Plan the exhaust fan now', body: 'The fan should vent to the outdoors (never into the attic) and be sized for the room. A quiet one on a humidity sensor is the one that actually runs. In Florida humidity this is what keeps mold out of a new bath.', ask: 'contractor' }),
  A({ id: 'bath-face-light', rooms: WET, title: 'Light the face, not just the ceiling', body: 'Ceiling lights alone put shadows under eyes and chin. Sconces at about eye level on both sides of the mirror, on a dimmer, are what make a vanity pleasant to use.', ask: 'designer' }),
  A({ id: 'bath-blocking', rooms: WET, title: 'Add wood blocking before the walls close', body: 'Solid blocking inside the walls for towel bars, a glass panel, a wall-hung vanity and future grab bars costs almost nothing now and is a tear-out later.', ask: 'contractor' }),
  A({ id: 'bath-power', rooms: WET, title: 'Decide outlets and heat before tile', body: 'Vanity outlets need ground-fault protection and usually their own 20 amp circuit. An outlet inside a drawer or medicine cabinet hides chargers. Heated floors and towel warmers each need a circuit and go in before the floor tile.', ask: 'electrician' }),
  A({ id: 'bath-slip', rooms: WET, when: /floor|tile|marble|stone|porcelain|herringbone/i, title: 'Ask for the wet slip rating of floor tile', body: 'Polished stone is slick when wet. For a bath floor ask for the tile\'s wet traction rating (a DCOF of 0.42 or higher is the usual target). Smaller tile or a honed finish grips better, and the shower floor needs small tile to follow the slope.', ask: 'designer' }),
  A({ id: 'bath-paint', rooms: WET, when: /paint|wall color|colou?r/i, title: 'Use a paint made for baths', body: 'Choose a moisture-resistant finish (satin or semi-gloss) and look at the sample in this room in the morning and at night; the same color shifts a lot between daylight and warm bulbs.', ask: 'designer' }),
  A({ id: 'bath-niche', rooms: WET, when: /niche|shelf|storage|medicine|cabinet/i, title: 'Recessed storage is framed, not added', body: 'Shower niches and recessed medicine cabinets sit between studs, so they are placed before plumbing and wiring. Keep niches off outside walls where they displace insulation.', ask: 'contractor' }),

  // ------------------------------------------------------------ kitchens
  A({ id: 'kit-island-services', rooms: ['kitchen'], when: /island/i, title: 'An island sink or cooktop needs a route through the floor', body: 'Water, a drain with a vent, power and maybe gas all have to reach the island under the floor. Have the plumber and the engineer look at that route, and at whatever holds up the floor there, before the island is placed.', ask: 'plumber' }),
  A({ id: 'kit-island-size', rooms: ['kitchen'], when: /island|peninsula|seating|stool/i, title: 'Size the island for reach and for walking past', body: 'Much deeper than 4 feet and the middle cannot be reached to wipe. Keep 42 inches of aisle for one cook, 48 for two, and allow 24 inches of width per stool with 12 to 15 inches of knee space.', ask: 'designer' }),
  A({ id: 'kit-cabinets', rooms: ['kitchen'], when: /cabinet|cupboard|shaker|drawer|pantry/i, title: 'Lock appliances before ordering cabinets', body: 'Cabinets are built around exact appliance sizes, and lead times run two to three months. Decide whether cabinets go to the ceiling, where fillers fall, and what gets drawers (pots, trash, trays) before the order.', ask: 'designer' }),
  A({ id: 'kit-counter', rooms: ['kitchen'], when: /counter|quartz|marble|granite|soapstone|butcher|backsplash|slab/i, title: 'Choose counters knowing how they age', body: 'Marble etches and stains (honed hides it better). Quartz does not like hot pans. Ask where seams will fall, and support any overhang past about 10 to 12 inches. Backsplash outlets should be planned with the tile, not after.', ask: 'designer' }),
  A({ id: 'kit-hood', rooms: ['kitchen'], when: /range|cooktop|stove|hood|vent|oven/i, title: 'Vent the cooking outdoors, and check make-up air', body: 'A hood should duct outside and be at least as wide as the cooktop. Strong hoods (over about 400 cubic feet a minute) need a make-up air supply by code. A hood over an island has to duct through the ceiling, so settle that route early.', ask: 'contractor' }),
  A({ id: 'kit-appliance', rooms: ['kitchen'], when: /fridge|refrigerator|freezer|range|oven|cooktop|dishwasher|microwave|induction|gas/i, title: 'Check doors, power and water for every appliance', body: 'Open every door on paper: refrigerator into the island, dishwasher into the walkway, oven into a corner. Induction needs a heavy circuit, a refrigerator with ice needs a water line, and a gas range needs its shutoff reachable.', ask: 'electrician' }),
  A({ id: 'kit-floor', rooms: ['kitchen'], when: /floor|tile|brick|stone|wood|plank|herringbone/i, title: 'Run the floor under the appliances', body: 'Flooring should run under the range, dishwasher and refrigerator so they can be pulled out later. Check the finished height against the rooms next door, and know that brick and stone need sealing and are hard on feet and dropped dishes.', ask: 'contractor' }),
  A({ id: 'kit-landing', rooms: ['kitchen'], title: 'Leave a place to set things down', body: 'Plan counter beside every appliance: about 15 inches next to the refrigerator handle, 12 to 15 on each side of the cooktop, and 18 to 24 beside the sink. Missing landing space is the most common regret.', ask: 'designer' }),
  A({ id: 'kit-light', rooms: ['kitchen'], title: 'Three kinds of light', body: 'Under-cabinet lights for the counters, pendants about 30 to 36 inches above the island, and ceiling lights placed over the counter edge so you do not work in your own shadow. Put each on its own dimmer.', ask: 'electrician' }),
  A({ id: 'kit-power', rooms: ['kitchen'], title: 'Plan outlets and circuits with the cabinets', body: 'Counters need outlets every few feet, and islands have their own rules. The microwave, dishwasher, disposal and refrigerator usually each get a circuit. Decide pop-ups, appliance garages and charging spots before cabinets are ordered.', ask: 'electrician' }),

  // ------------------------------------------------------------ bedrooms
  A({ id: 'bed-egress', rooms: ['bedroom'], when: /window|door|closet|wall/i, title: 'Keep the escape window', body: 'Every bedroom needs a window or door a person can climb out of. Changing or covering a bedroom window, or building a closet in front of it, can make the room no longer a legal bedroom.', ask: 'architect' }),
  A({ id: 'bed-power', rooms: ['bedroom'], title: 'Wire for how the bed wall will be used', body: 'Outlets and switches at nightstand height on both sides of the bed, a switch for reading sconces, and a ceiling box rated for a fan are cheap now and awkward later.', ask: 'electrician' }),
  A({ id: 'bed-clear', rooms: ['bedroom'], when: /bed|dresser|furniture|rug|bench|chair/i, title: 'Leave room to walk around the bed', body: 'Allow 24 to 30 inches on each side of the bed and at its foot, and check that dresser drawers and closet doors can open fully.', ask: 'designer' }),

  // ------------------------------------------------------------ laundry
  A({ id: 'laundry-vent', rooms: ['laundry'], title: 'Keep the dryer vent short, smooth and outdoors', body: 'Rigid metal duct, as straight as possible, ending outside with a cleanable hood. Long or crushed dryer ducts are a fire and moisture problem; ask for the measured length and where it can be cleaned.', ask: 'contractor' }),
  A({ id: 'laundry-leak', rooms: ['laundry'], title: 'Protect what is under the washer', body: 'On an upper floor put the washer in a drained pan and add an automatic shutoff valve. A burst supply hose is one of the most common home insurance claims.', ask: 'plumber' }),
  A({ id: 'laundry-fit', rooms: ['laundry'], when: /counter|cabinet|stack|sink|shelf|door/i, title: 'Measure the machines with their doors open', body: 'Front loaders need about 4 feet in front to load, counters over them need the machines\' depth plus hoses (often 32 inches or more), and a laundry in a closet needs louvered doors or another way for the dryer to get air.', ask: 'designer' }),

  // ------------------------------------------------------------ living spaces, halls, closets, outside
  A({ id: 'live-power', rooms: ['living'], title: 'Put power where the furniture will be', body: 'Floor outlets under a sofa that floats in the room, conduit and blocking behind the television, and switched outlets for lamps are easy before the floor and walls are finished.', ask: 'electrician' }),
  A({ id: 'live-fire', rooms: ['living'], when: /fireplace|mantel|hearth|stove|tv|television/i, title: 'Fireplaces set their own clearances', body: 'Wood trim, mantels and televisions have minimum distances from a firebox opening that depend on the unit. Get the fireplace\'s installation sheet before designing the wall around it.', ask: 'contractor' }),
  A({ id: 'live-air', rooms: ['living', 'bedroom', 'closet', 'hall'], when: /built.?in|bookcase|cabinet|shelv|wall|bench/i, title: 'Do not bury the air vents', body: 'Built-ins and new walls often land on a supply or return grille. Moving one is simple if it is planned, and a covered return makes the whole system work harder.', ask: 'contractor' }),
  A({ id: 'hall-stair', rooms: ['hall'], when: /stair|rail|baluster|banister|step|landing/i, title: 'Stairs and rails are life-safety work', body: 'Handrails sit 34 to 38 inches above the steps, guards are at least 36 inches high, and balusters must not let a 4 inch ball through. Changing a stair changes all of these, so it needs a drawing and a permit.', ask: 'architect' }),
  A({ id: 'closet-fit', rooms: ['closet'], title: 'Closets work by inches', body: 'Hanging clothes need 24 inches of clear depth. Double rods sit at about 40 and 80 inches. Closet lights must be enclosed fixtures kept clear of shelves.', ask: 'designer' }),
  A({ id: 'out-deck', rooms: ['outside'], title: 'Decks fail where they meet the house', body: 'Ask how the deck is fastened and flashed at the house wall, how deep the footings go, and plan a 36 inch guard wherever the walking surface is more than 30 inches above the ground.', ask: 'engineer' }),

  // ------------------------------------------------------------ any room
  A({ id: 'any-wall', rooms: 'any', when: /remove (the |this |that )?wall|take (out|down)|knock|open(ing)? (up|the wall)|open concept|widen|wider (door|opening)|archway|pass.?through|half wall/i, title: 'A wall may be holding the house up', body: 'Before a wall comes out or an opening gets wider, a structural engineer needs to say what it carries and size the beam. Walls also hide wiring, pipes and ducts that have to be rerouted, and the floor needs patching where the wall stood.', ask: 'engineer' }),
  A({ id: 'any-opening', rooms: 'any', when: /window|french door|patio door|sliding door|slider|skylight|glass wall|bigger door|new door/i, title: 'New windows and outside doors are structural and rated', body: 'A new or wider opening in an outside wall needs an engineered header. In Florida, exterior windows and doors must carry a Florida Product Approval for wind and water, and the work needs a permit.', ask: 'architect' }),
  A({ id: 'any-door', rooms: 'any', when: /pocket door|barn door|door swing|swing the door|rehang/i, title: 'Check what a door needs from its wall', body: 'A pocket door needs a stretch of wall as wide as the door with no pipes, wires or switches in it. A barn door needs the same width of clear wall beside the opening and does not seal out sound or steam.', ask: 'contractor' }),
  A({ id: 'any-light-color', rooms: 'any', when: /light|sconce|pendant|recessed|chandelier|lamp|bulb/i, title: 'Pick one color of light for the house', body: 'Choose one warmth (2700K or 3000K) and bulbs with a color rendering of 90 or more, and use them everywhere. Mixed bulbs make the same paint look like two colors.', ask: 'designer' }),
  A({ id: 'any-sample', rooms: 'any', when: /paint|colou?r|tile|counter|floor|cabinet|stain|wallpaper|fabric/i, title: 'See the real sample in this room', body: 'These pictures show the mood, not the exact shade. Before ordering, put a physical sample in the room and look at it in morning light, evening light and under the bulbs you will use.', ask: 'designer' }),
  A({ id: 'any-old', rooms: 'any', when: /demo|tear out|remove|rip out|sand|replace the floor|pull up|popcorn/i, title: 'Test before sanding or tearing out', body: 'If the house was built before 1978, have paint tested for lead before sanding, and have old sheet flooring, ceiling texture and duct wrap tested for asbestos before demolition.', ask: 'contractor' }),
  A({ id: 'any-moisture', rooms: ['bath', 'laundry', 'kitchen'], title: 'Fix moisture before finishes', body: 'New finishes over old dampness fail. Any past leak or mold in this area should be traced to its cause, repaired and dried, with that confirmed, before walls are closed.', ask: 'contractor' }),
  A({ id: 'any-permit', rooms: 'any', when: /move|wall|window|door|plumb|electric|outlet|circuit|shower|tub|toilet|island|remodel|addition|deck/i, title: 'Know what needs a permit', body: 'Moving plumbing, adding circuits, structural changes and new windows or outside doors need permits and inspections. Paint, flooring and like-for-like fixtures usually do not. Unpermitted work can cause trouble with insurance and resale.', ask: 'contractor' }),
  A({ id: 'any-order', rooms: 'any', when: /remodel|gut|renovat|new layout|redo the|whole (room|bath|kitchen)/i, title: 'Choose fixtures before the rough-in', body: 'Valve heights, drain positions and outlet boxes are set by the exact fixtures, tile and cabinets. Choosing them after the plumber and electrician rough in is how walls get reopened. Keep 10 to 15 percent of the budget for what is found inside the walls.', ask: 'contractor' }),
]

/** Notes for a room: the ones the talk about this room has touched first, then standing advice for its kind. */
export function adviceFor(kind: RoomKind, said: string): { raised: Advice[]; standing: Advice[] } {
  const fits = (a: Advice) => a.rooms === 'any' || a.rooms.includes(kind)
  const raised: Advice[] = []
  const standing: Advice[] = []
  for (const a of ADVICE) {
    if (!fits(a)) continue
    if (a.when) {
      if (said && a.when.test(said)) raised.push(a)
    } else standing.push(a)
  }
  return { raised, standing }
}

export const ASK_WORDS: Record<string, string> = {
  designer: 'Ask your designer',
  architect: 'Ask your architect',
  engineer: 'Ask a structural engineer',
  plumber: 'Ask the plumber',
  electrician: 'Ask the electrician',
  contractor: 'Ask the contractor',
  none: '',
}
