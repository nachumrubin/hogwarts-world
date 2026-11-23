# Equine anatomy and grazing correction

[Open the synchronised comparisons](https://nachumrubin.github.io/hogwarts-world/review/equine-correction/) · [Previous review](../stage-1b/) · [Stage 1B source](https://github.com/nachumrubin/hogwarts-world/tree/1d867e291f8877b95b3d20bdfda84e07710c1e81/creature-lab)

## Leg mechanics

The previous foreleg and hindleg used different bend signs on the same two-link solution. The fetlock and hoof followed the cannon as a single rigid unit. A stride calculated in body coordinates could move a supporting hoof when the animal turned, accelerated or changed action.

The revised skeleton places the elbow behind the shoulder, the stifle ahead of the hip, and the hock behind the stifle. The carpus stays close to extension in loaded forelimb stance and folds during swing. Hindlimb flexion couples the stifle and hock. The fetlock and oblique pastern articulate above a separately oriented hoof. Smooth cross-sections distribute the upper-limb mass and taper into the cannon. The centaur carries heavier limbs, and the unicorn has a taller cannon and slimmer profile.

Each stance has a world-space touchdown target. The body advances over it before the next swing, with a small vertical and lateral weight shift. A four-beat walk, predicted landings and gradual changes in speed and yaw keep the stride continuous through turns. Grounded soles are measured from their actual mesh vertices.

Structural references are the University of Minnesota College of Veterinary Medicine’s [thoracic limb](https://pressbooks.umn.edu/largeanimalanatomy/chapter/thoracic-limb-forelimb/) and [pelvic limb](https://pressbooks.umn.edu/largeanimalanatomy/chapter/pelvic-limb/) teaching guides. Dimensions and gait amplitudes are model-specific.

## Cervical deformation

The former rig linearly blended a stationary trunk matrix with a neck matrix rotated approximately 118° during grazing. At intermediate weights this compressed the section in the plane of rotation. The unicorn’s nonuniform body scale also affected world-space area. At the middle station, full lowering removed about half the original area.

The revised rig turns successive cross-sections as rigid sections along the existing mesh. It transports their centres using the resting segment lengths in physical coordinates and applies a gradual bend through the withers, crest and poll. The mane attaches to the same section frames. Shoulder loading and poll rotation contribute to the ground reach.

## Verification

The gallery contains seven pairs of 24 fps clips and three pairs of neck close-ups. Walks use matched side, three-quarter and joint-overlay cameras. Both revisions use identical cameras, studio lighting, simulation schedules and a stationary 25 cm grid. The overlay draws the actual articulated pivots available in each revision. On the revised rig the green marker identifies the stance anchor, amber marks swing and dashed lines identify the far limbs.

The [numerical report](measurements.json) records deformed ring area relative to neutral at three detail levels throughout 541 grazing frames. It also tracks nine mane roots against corresponding points on the neck, muzzle clearance and every sampled sole-patch vertex. The four level-ground trials cover walking with variable speed, turning, stopping, grazing, and walking into and out of a graze. Knee inversion uses a signed sagittal offset with 5 mm tolerance. Segment length is measured from consecutive skeletal landmarks after world transforms.

Across all sampled neck rings and all three detail levels, the largest absolute area change in the revised rig rounded to 0.00000000%. The baseline lost up to 50.64%. The revised mid-neck retained its standing area at both halfway and full graze. The largest change in mane-root distance from the corresponding surface point fell from 63.53 cm to 2.25 mm.

The habitat check used the visible ground mesh. Each species walked for 0, 5, 10, 15, 20, 25 or 30 seconds before stopping. The unicorn then grazed for five seconds. Independent vertical ray tests against the ground triangles put the lowest muzzle vertex 2.81–9.22 mm above the floor during the final second. Planted hoof centres stayed on the rendered ground within 0.001 mm. A rigid sole spanning a triangle edge could sit as much as 5.77 mm below or 9.39 mm above the floor at its outermost measured vertex.

The shoulder now flows into the barrel in the side and three-quarter views. A small crease remains where the moving forelimb emerges below the chest.

The high-detail triangle audit checked 481 poses per species per revision. It tested nonadjacent faces for limb-skin self-intersections, unicorn torso self-intersections, separate limbs and hooves against one another, distal limbs against the trunk, and the muzzle against the limb meshes. Intended proximal shoulder/hip attachments and pastern-to-hoof joins overlap. The revised trial found zero intersecting pairs in the tested surfaces. This is a sampled check. [Before](intersections-before.json) · [After](intersections-after.json)

## Repeat the tests

Run these commands from the repository root with Node.js, Blender, Python Playwright, Chromium and FFmpeg available. The detached worktree supplies the exact reviewed baseline.

```sh
git worktree add --detach ../equine-before 1d867e291f8877b95b3d20bdfda84e07710c1e81
out=creature-lab/review/equine-correction
node tools/measure-equine-motion.mjs ../equine-before/creature-lab creature-lab "$out/measurements.json"
blender -b --python-exit-code 1 -P tools/check-equine-intersections.py -- ../equine-before/creature-lab "$out/intersections-before.json"
blender -b --python-exit-code 1 -P tools/check-equine-intersections.py -- creature-lab "$out/intersections-after.json"
python tools/capture-equine-review.py ../equine-before/creature-lab before
python tools/capture-equine-review.py creature-lab after
```
