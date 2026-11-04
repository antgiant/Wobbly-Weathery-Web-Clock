//! How each landscape colours the ground, baked from the web page by tools/native-landscape.mjs (do not edit by hand; regenerate it).
//! Per landscape: multipliers of the flat ground's colour at midday and at night (mean colour of the lower part of the picture).

pub const LANDS: usize = 6;
pub const GROUND: [(&str, [f64; 3], [f64; 3]); LANDS] = [
    ("flat", [1.000, 1.000, 1.000], [1.000, 1.000, 1.000]),
    ("hills", [1.000, 1.000, 1.000], [1.000, 1.000, 1.000]),
    ("mountains", [0.998, 0.998, 0.992], [0.984, 0.990, 0.987]),
    ("desert", [2.269, 1.311, 2.023], [2.065, 1.336, 1.438]),
    ("ocean", [0.798, 0.907, 2.483], [3.031, 2.257, 2.537]),
    ("city", [1.396, 0.902, 1.932], [1.177, 0.894, 1.166]),
];
