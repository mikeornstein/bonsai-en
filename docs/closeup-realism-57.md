# Close-up realism audit (#57)

## Capture

```bash
npm run dev                    # Terminal A
npm run screenshots:detail     # Terminal B → screenshots/10–15-detail-*.png
```

Harness: `window.__bonsai.setCloseUp({ x, y, z, distance, azimuth, elevation, fov })`  
Targets are soil-local (same as `listNodes().tip*` / `base*`). Physics frozen; practice ghost off; UI hidden.

**Soft-GL note:** Puppeteer + SwiftShader skips product DOF/grade. Geometry and material values still audit; lighting/DOF art review needs a real GPU grab.

## Zone findings → fixes

| Zone | Finding (pre-fix hypothesis / close-up) | Fix landed |
|------|------------------------------------------|------------|
| **R** Nebari / soil | Single pole-like root; soil–trunk seam can read as float or hard cut; little surface flare | Stronger root radius flare; 5 visual surface-root lobes; deeper bury; darker base bark; wider soil mound; soft trunk contact shadow on soil |
| **J** Joints | Sphere collars read as ball bearings; parent→child radius steps | Elongated capsule collars oriented on branch axis; tip joint sized to child blend; soft parent-tip continuity on child r0 |
| **F** Foliage | Pads floated beside wood; hard cardboard alpha | Origin cluster seated on bark; pad cloud fans from attach; softer alpha falloff + lower alphaTest; slightly stronger sheen |

## Success questions (at 100% crop)

1. Does the trunk **belong** to the soil?  
2. Does a branch **grow out of** wood, not a ball joint?  
3. Do pads **leave** the shoot rather than hover beside it?
