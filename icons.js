// ============================================
// ANIMATED WEATHER ICONS (SVG-based)
// Monoline glyph set: rotating sun, drifting cloud silhouette, staggered
// rain/snow, striking bolt, layered fog, banded sunset, crescent moon with
// sparkles. Buckets: clearDay, clearNight, partly, overcast, rain, storm,
// snow, fog, sunset.
// ============================================

const WeatherIcons = {
    // Map free-text NWS/condition strings (+ night/sunset context) to one of
    // the nine sky buckets the icon and canvas-sky systems both key off of.
    bucketFor(text, isNight, sunset) {
        const t = String(text || "").toLowerCase();
        if (t.includes("thunder") || t.includes("storm")) return "storm";
        if (t.includes("snow") || t.includes("sleet") || t.includes("ice") || t.includes("flurr") || t.includes("wintry")) return "snow";
        if (t.includes("fog") || t.includes("mist") || t.includes("haze")) return "fog";
        if (t.includes("rain") || t.includes("shower") || t.includes("drizzle")) return "rain";
        if (t.includes("partly") || t.includes("mostly clear") || t.includes("mostly sunny")) {
            return sunset ? "sunset" : (isNight ? "clearNight" : "partly");
        }
        if (t.includes("cloud") || t.includes("overcast")) return "overcast";
        return sunset ? "sunset" : (isNight ? "clearNight" : "clearDay");
    },

    // Resolve a free-text condition (e.g. NWS shortForecast) to an icon.
    // opts: { animated: bool, sunset: bool, color: string }
    fromText(text, isNight = false, opts = {}) {
        const bucket = this.bucketFor(text, isNight, !!opts.sunset);
        return this.render(bucket, opts);
    },

    render(bucket, opts = {}) {
        const anim = !!opts.animated;
        const color = opts.color || "#ffffff";
        const soft = opts.color || "rgba(255,255,255,0.92)";
        const sw = opts.weight || 1.6;
        const base = `fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
        const softAttr = `fill="none" stroke="${soft}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;

        const CLOUD = "M20.5 46.5h22.8a9.4 9.4 0 0 0 1.2-18.7 14.2 14.2 0 0 0-26.6-3.4 9.6 9.6 0 0 0 2.6 22.1z";
        const cloud = (dx, dy, s = 1, opacity = 1, dur = 8) => `
            <path d="${CLOUD}" ${softAttr} opacity="${opacity}"
                transform="translate(${dx} ${dy}) scale(${s})"
                style="${anim ? `transform-box:fill-box;transform-origin:center;animation:wxDrift ${dur}s ease-in-out infinite;` : ""}"/>`;

        const sun = (cx, cy, r, rays = 8) => {
            let lines = "";
            for (let i = 0; i < rays; i++) {
                const a = (i * 2 * Math.PI) / rays + Math.PI / 8;
                const x1 = cx + Math.cos(a) * (r + 4.5), y1 = cy + Math.sin(a) * (r + 4.5);
                const x2 = cx + Math.cos(a) * (r + 9.5), y2 = cy + Math.sin(a) * (r + 9.5);
                lines += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" ${base}/>`;
            }
            return `
            <g style="${anim ? `transform-origin:${cx}px ${cy}px;animation:wxSpin 40s linear infinite;` : ""}">${lines}</g>
            <circle cx="${cx}" cy="${cy}" r="${r}" ${base}/>`;
        };

        const drops = (n, y0, kind) => {
            let out = "";
            for (let i = 0; i < n; i++) {
                const x = 24 + i * (kind === "storm" ? 16 : 8.5);
                if (kind === "snow") {
                    out += `
                    <g style="${anim ? `transform-box:fill-box;transform-origin:center;animation:wxFlake 2.1s linear ${(i * 0.34).toFixed(2)}s infinite;` : ""}">
                        <g transform="translate(${x} ${y0 + 4})">
                            <line x1="0" y1="-3.2" x2="0" y2="3.2" ${base}/>
                            <line x1="-2.8" y1="-1.6" x2="2.8" y2="1.6" ${base}/>
                            <line x1="-2.8" y1="1.6" x2="2.8" y2="-1.6" ${base}/>
                        </g>
                    </g>`;
                } else {
                    out += `
                    <line x1="${x}" y1="${y0}" x2="${x - 2}" y2="${y0 + 7}" fill="none" stroke="${color}" stroke-width="${(sw * 1.1).toFixed(2)}" stroke-linecap="round"
                        style="${anim ? `animation:wxDrop 1.45s linear ${(i * 0.26).toFixed(2)}s infinite;` : ""}"/>`;
                }
            }
            return out;
        };

        const wrap = (inner) => `<svg viewBox="0 0 64 64" width="100%" height="100%" style="display:block;overflow:visible" aria-hidden="true">${inner}</svg>`;

        switch (bucket) {
            case "clearDay":
                return wrap(sun(32, 32, 12));

            case "clearNight": {
                const stars = [[15, 18, 2.2], [22, 44, 1.6], [50, 50, 1.9]].map(([x, y, r], i) => `
                    <g style="${anim ? `transform-box:fill-box;transform-origin:center;animation:wxBreathe ${2.6 + i * 0.8}s ease-in-out infinite;` : ""}">
                        <path d="M${x} ${y - r}l${(r * 0.42).toFixed(2)} ${(r * 0.58).toFixed(2)} ${(r * 0.58).toFixed(2)} ${(r * 0.42).toFixed(2)}-${(r * 0.58).toFixed(2)} ${(r * 0.42).toFixed(2)}-${(r * 0.42).toFixed(2)} ${(r * 0.58).toFixed(2)}-${(r * 0.42).toFixed(2)}-${(r * 0.58).toFixed(2)}-${(r * 0.58).toFixed(2)}-${(r * 0.42).toFixed(2)} ${(r * 0.58).toFixed(2)}-${(r * 0.42).toFixed(2)}z" fill="${color}" stroke="none"/>
                    </g>`).join("");
                return wrap(`<path d="M40.5 12.5a19 19 0 1 0 12.2 27.9A20.5 20.5 0 0 1 40.5 12.5z" ${base}/>${stars}`);
            }

            case "partly":
                return wrap(sun(43, 20, 8.5, 8) + cloud(-2, 5, 1));

            case "overcast":
                return wrap(cloud(4, -6, 0.82, 0.5, 9) + cloud(-3, 5, 1, 1, 9));

            case "rain":
                return wrap(cloud(-2, -3, 1, 1, 8) + drops(4, 50));

            case "storm": {
                const bolt = `<path d="M34 44l-7.5 10.5H32l-3 8.5 10.5-12.5H33l4-6.5z" fill="rgba(255,232,160,.95)" stroke="none"
                    style="${anim ? "animation:wxBolt 3.2s linear infinite;" : ""}"/>`;
                return wrap(cloud(-2, -5, 1, 1, 8) + drops(2, 49, "storm") + bolt);
            }

            case "snow":
                return wrap(cloud(-2, -4, 1, 1, 8) + drops(3, 49, "snow"));

            case "fog": {
                let lines = "";
                for (let i = 0; i < 3; i++) {
                    const x1 = 15 + (i % 2) * 6, x2 = 49 - (i % 2) * 5, y = 45 + i * 6;
                    lines += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" fill="none" stroke="${soft}" stroke-width="${(sw * 1.05).toFixed(2)}" stroke-linecap="round" opacity="${1 - i * 0.2}"
                        style="${anim ? `animation:wxDrift ${5 + i * 1.4}s ease-in-out infinite;` : ""}"/>`;
                }
                return wrap(cloud(-2, -10, 0.9, 0.85, 8) + lines);
            }

            case "sunset": {
                const rays = [[10, 30], [54, 30], [16, 20], [48, 20]].map(([x, y]) =>
                    `<line x1="${x}" y1="${y}" x2="${x + (x < 32 ? -3.5 : 3.5)}" y2="${y - 2.5}" ${base}/>`).join("");
                return wrap(`
                    <g style="${anim ? "transform-origin:32px 38px;animation:wxBreathe 6.5s ease-in-out infinite;" : ""}">
                        <path d="M21 38a11 11 0 0 1 22 0" ${base}/>
                    </g>
                    ${rays}
                    <line x1="10" y1="44" x2="54" y2="44" ${base}/>
                    <line x1="18" y1="51" x2="46" y2="51" ${softAttr} opacity="0.55"/>
                    <line x1="26" y1="58" x2="38" y2="58" ${softAttr} opacity="0.3"/>`);
            }

            default:
                return wrap(sun(32, 32, 12));
        }
    }
};

// If you're using modules:
// export default WeatherIcons;

// If you're using plain <script> tags, just leave it like this — WeatherIcons will be global
