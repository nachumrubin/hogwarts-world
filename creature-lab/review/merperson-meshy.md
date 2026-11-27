# Meshy merperson integration

Creature Lab selects the supplied Meshy model for the Merperson specimen. Open `?specimen=merperson` to review it directly. Append `&merperson=baseline` to use the previous procedural model throughout the lab.

The checked-in GLB is a byte-for-byte copy of the user-supplied `Meshy_AI_merperson_smart_topology_20261127_texture.glb`. Its SHA-256 is `4a508918b566db4521b106428fcdc721f28eabe7c189a1342b83f99d9d2b1dbf`. The integration preserves the index buffer, 2,240 positions and normals, UVs, and the three 2,048 × 2,048 source maps. It uses the glTF sRGB base color, linear normal map, green-channel roughness, blue-channel metalness, and double-sided rendering. The same 2,657-triangle mesh is used at all LOD settings.

The export contains a single static primitive. The integration adds skin weights at runtime and uses the existing seven-state swim controller, original root and body motion, head counter-rotation, and retargeted arm and tail poses. The model uses an asset-specific bind pose and uniform scale. It lacks independent facial, finger, or hair animation. Extreme motion deserves visual review around the shoulders, tail and arms because they share a low-poly surface, and the source has no animator-authored weights or corrective shapes.

The existing habitat viewport uses WebGL 2, including the lake effects, neutral and silhouette inspection, wireframe and normal diagnostics. **Textured studio · WebGPU** draws the same authored material channels and rig in a native studio pass using the lab’s inspection canvas and readback pattern. Its lights differ from the lake lights. It falls back to the WebGL studio if WebGPU is unavailable. The world renderer has no GLB material path and is outside the scope of this integration.
