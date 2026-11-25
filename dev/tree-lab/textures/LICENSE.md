# Bark texture sources

All four layers are derived from Poly Haven texture scans, released under CC0 1.0 (public domain dedication).
Attribution is not required; it is given here as a courtesy. `tools/textures.py --fetch` downloads the 1k source
maps (diffuse, OpenGL normal, roughness, displacement, AO) from a CC0 git mirror (github.com/zuujis-cc0) and
rebuilds the layers deterministically.

| layer | source | changes |
|---|---|---|
| `oak` | https://polyhaven.com/a/bark_willow_02 | slightly browner and darker; packed |
| `pinelow` | https://polyhaven.com/a/pine_bark | desaturated towards grey-brown, darker plates |
| `pineup` | https://polyhaven.com/a/japanese_zelkova_bark | recoloured to orange-copper flakes |
| `birch` | https://polyhaven.com/a/sakura_bark | recoloured to white paper bark; dark lenticels and cracks from the scan's own features, plus seeded synthetic lenticels and peeling strips |
