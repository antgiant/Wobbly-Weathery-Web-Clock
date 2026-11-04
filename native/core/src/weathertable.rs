//! How each manual weather setting changes the sky, baked from the web page by tools/native-weather.mjs (do not edit by hand; regenerate it).
//! Per setting: multipliers of the clear-sky colour for [top rgb, horizon rgb, ground rgb] measured at midday, and how much of the night's stars show
//! through (a judgement, not a measurement). Measured at 2026-06-21 16:00 UTC in New York.

pub const MODES: usize = 9;
pub const WEATHER: [(&str, [f64; 9], f64); MODES] = [
    ("clear", [1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000], 1.00),
    ("partly", [1.131, 1.000, 0.990, 1.017, 0.983, 0.983, 0.964, 0.957, 0.967], 0.60),
    ("cloudy", [1.497, 0.951, 0.842, 1.005, 0.960, 0.976, 0.962, 0.956, 0.981], 0.25),
    ("overcast", [1.493, 1.019, 0.896, 1.035, 0.992, 0.990, 1.002, 1.002, 1.010], 0.00),
    ("rain", [1.975, 1.237, 1.015, 1.108, 1.034, 1.013, 1.036, 1.028, 1.320], 0.00),
    ("storm", [2.153, 1.311, 1.048, 1.142, 1.051, 1.023, 1.039, 1.025, 1.543], 0.00),
    ("snow", [1.986, 1.243, 1.018, 1.086, 1.015, 1.006, 2.580, 1.653, 2.989], 0.00),
    ("fog", [1.837, 1.226, 1.033, 1.072, 1.023, 1.015, 1.786, 1.440, 2.814], 0.05),
    ("haze", [1.412, 1.086, 0.998, 1.017, 0.957, 0.968, 0.971, 0.971, 0.972], 0.50),
];
