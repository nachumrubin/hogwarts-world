# Merperson swimming and articulation

## Tail and fluke

The tail wave starts at the lower torso and travels aft in distance along the centerline. The rig integrates rotated rest-length steps to build the posed curve. Each mesh ring moves in the corresponding interpolated frame, preserving the shape and size of its cross-section. All three LODs sample the same posed curve. The skin shader reads rest coordinates so scales stay attached through large bends.

The fluke spans horizontally and follows the peduncle. Its trailing edge flexes behind the main stroke and the two lobes respond slightly differently during a turn. The dorsal and paired fins follow the same deformation as their attachment points.

## Coordination and controls

The Lab exposes Hover in place, Slow cruise, Fast swim, Bank left, Bank right, Glide, and Brake and stop. Speed, thrust, stroke frequency, trim, and steering blend independently. Fast swim uses a deeper, quicker stroke and a more horizontal torso. Glide carries speed from the preceding stroke as the tail settles. Hover uses small strokes and hand sculling. Banking drives the outside arm into a steering posture, and braking fans both arms and opens the hands as speed drops.

Two-bone shoulder and elbow solves preserve limb lengths. Wrists feather relative to the forearms, and each digit has three articulated joints. The webbing shares the joints of the neighboring fingers. The head counter-rotates against pitch and bank, and the hair trails body motion with different timing across the locks.

## Verification and limits

The side comparison uses the same camera, lighting, resolution, two-second lead-in, Fast swim action, and root tracking on baseline `6217c7a` and the candidate. The three-quarter and maneuver clips use the production Lab and its material inspection lighting. The camera follows the root in those clips and partially follows heading in the maneuver clip. The hand camera follows the left wrist and looks onto the webbing from above the palm.

The focused tests check centerline length, cross-section dimensions at all LODs, preservation of pose across LOD changes, left and right steering, coasting, braking, and finite posed hand geometry. It is a kinematic rig. Hydrodynamic force, obstacle response, and exhaustive surface collision are outside the current rig. Glide and braking carry the momentum present when selected. Cutaneous normals are rotated with each tail frame, so the shading is approximate at the tightest bends. Hardware GPU cost was not measured.

Reproduce the footage with `node tools/capture-stage-1b.mjs <creature-lab-directory> before merperson-motion` on the baseline checkout and `node tools/capture-stage-1b.mjs creature-lab after merperson-motion` on the candidate. Set `CREATURE_CAPTURE_MOTION_CLIP` to `side`, `three-quarter`, `maneuvers`, or `hands` to record one candidate clip.
