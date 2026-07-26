/**
 * Shared numeric env bounds for physics (tree-local space).
 * Root base is at origin; render buries the root slightly under the soil
 * (see TreeRenderer group offset / POT_SOIL_LOCAL_Y).
 *
 * Pot walls are not colliders — only the soil plane is used for env contact.
 */

/** Soil surface Y in tree-local space (root at 0 sits just under the soil). */
export const TREE_SOIL_Y = 0.0025;
