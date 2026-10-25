var e = (e, t) => [e[0] - t[0], e[1] - t[1]], t = (e, t) => e[0] * t[0] + e[1] * t[1], n = (e, t) => Math.hypot(e[0] - t[0], e[1] - t[1]), r = (e, t, n) => [e[0] + (t[0] - e[0]) * n, e[1] + (t[1] - e[1]) * n], i = (e) => Math.round(e * 100) / 100, a = (e) => [i(e[0]), i(e[1])];
function o(e) {
	return n(e.a, e.b);
}
function s(i, a, o) {
	let s = e(o, a), c = t(s, s);
	return c < 1e-9 ? n(i, a) : n(i, r(a, o, Math.max(0, Math.min(1, t(e(i, a), s) / c))));
}
function c(e, t) {
	let n = !1;
	for (let r = 0, i = t.length - 1; r < t.length; i = r++) {
		let [a, o] = t[r], [s, c] = t[i];
		o > e[1] != c > e[1] && e[0] < (s - a) * (e[1] - o) / (c - o) + a && (n = !n);
	}
	return n;
}
function l(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) {
		let r = e[n], i = e[(n + 1) % e.length];
		t += r[0] * i[1] - i[0] * r[1];
	}
	return t / 2;
}
var u = (e) => Math.abs(l(e));
function d(e) {
	let t = Infinity, n = Infinity, r = -Infinity, i = -Infinity;
	for (let [a, o] of e) a < t && (t = a), o < n && (n = o), a > r && (r = a), o > i && (i = o);
	return {
		x0: t,
		y0: n,
		x1: r,
		y1: i
	};
}
function f(e) {
	let t = l(e);
	if (Math.abs(t) < 1e-9) {
		let t = e.length || 1;
		return [e.reduce((e, t) => e + t[0], 0) / t, e.reduce((e, t) => e + t[1], 0) / t];
	}
	let n = 0, r = 0;
	for (let t = 0; t < e.length; t++) {
		let i = e[t], a = e[(t + 1) % e.length], o = i[0] * a[1] - a[0] * i[1];
		n += (i[0] + a[0]) * o, r += (i[1] + a[1]) * o;
	}
	return [n / (6 * t), r / (6 * t)];
}
function p(e, t = 1) {
	let n = d(e), r = (t) => {
		let n = Infinity;
		for (let r = 0; r < e.length; r++) n = Math.min(n, s(t, e[r], e[(r + 1) % e.length]));
		return c(t, e) ? n : -n;
	}, i = f(e), o = r(i), l = Math.max(n.x1 - n.x0, n.y1 - n.y0) / 8, u = (n.x0 + n.x1) / 2, p = (n.y0 + n.y1) / 2, m = Math.max(n.x1 - n.x0, n.y1 - n.y0);
	for (; l >= t;) {
		for (let e = u - m / 2; e <= u + m / 2; e += l) for (let t = p - m / 2; t <= p + m / 2; t += l) {
			let n = r([e, t]);
			n > o && (o = n, i = [e, t]);
		}
		u = i[0], p = i[1], m = l * 2, l /= 2;
	}
	return a(i);
}
//#endregion
//#region src/model/diff.ts
var m = (e, t) => ({
	id: e.id,
	level: e.level,
	length: h(o(e)),
	...t === void 0 ? {} : { move: h(t) },
	bearing: e.bearing,
	exterior: e.exterior
}), h = (e) => Math.round(e * 100) / 100, g = (e) => Math.round(u(e.polygon) / 144);
function _(e, t) {
	let r = new Map(e.walls.map((e) => [e.id, e])), i = new Map(t.walls.map((e) => [e.id, e])), a = {
		added: [],
		removed: [],
		moved: []
	};
	for (let e of t.walls) r.has(e.id) || a.added.push(m(e));
	for (let t of e.walls) i.has(t.id) || a.removed.push(m(t));
	for (let e of t.walls) {
		let t = r.get(e.id);
		if (!t) continue;
		let i = Math.max(n(t.a, e.a), n(t.b, e.b));
		(i > .05 || Math.abs(t.t - e.t) > .05) && a.moved.push(m(e, i));
	}
	let o = new Map(e.openings.map((e) => [e.id, e])), s = new Map(t.openings.map((e) => [e.id, e])), c = {
		added: [],
		removed: [],
		changed: []
	}, l = (e, t = []) => ({
		id: e.id,
		wall: e.wall,
		kind: e.kind,
		what: t
	});
	for (let e of t.openings) o.has(e.id) || c.added.push(l(e));
	for (let t of e.openings) s.has(t.id) || c.removed.push(l(t));
	for (let e of t.openings) {
		let t = o.get(e.id);
		if (!t) continue;
		let n = [];
		t.wall !== e.wall && n.push("wall"), Math.abs(t.at - e.at) > .05 && n.push("position"), Math.abs(t.w - e.w) > .05 && n.push("width"), Math.abs(t.h - e.h) > .05 && n.push("height"), (t.sill ?? 0) !== (e.sill ?? 0) && n.push("sill"), (t.kind !== e.kind || t.style !== e.style) && n.push("type"), JSON.stringify(t.swing ?? null) !== JSON.stringify(e.swing ?? null) && n.push("swing"), n.length && c.changed.push(l(e, n));
	}
	let u = new Map(e.rooms.map((e) => [e.id, e])), d = new Map(t.rooms.map((e) => [e.id, e])), f = {
		added: [],
		removed: [],
		renamed: [],
		resized: []
	};
	for (let e of t.rooms) u.has(e.id) || f.added.push({
		id: e.id,
		name: e.name,
		areaAfter: g(e)
	});
	for (let t of e.rooms) d.has(t.id) || f.removed.push({
		id: t.id,
		name: t.name,
		areaBefore: g(t)
	});
	for (let e of t.rooms) {
		let t = u.get(e.id);
		t && (t.name !== e.name && f.renamed.push({
			id: e.id,
			name: e.name,
			was: t.name
		}), g(t) !== g(e) && f.resized.push({
			id: e.id,
			name: e.name,
			areaBefore: g(t),
			areaAfter: g(e)
		}));
	}
	let p = new Map(e.items.map((e) => [e.id, e])), h = new Map(t.items.map((e) => [e.id, e])), _ = {
		added: [],
		removed: [],
		changed: []
	};
	for (let e of t.items) p.has(e.id) || _.added.push({
		id: e.id,
		label: e.label,
		kind: e.kind,
		what: []
	});
	for (let t of e.items) h.has(t.id) || _.removed.push({
		id: t.id,
		label: t.label,
		kind: t.kind,
		what: []
	});
	for (let e of t.items) {
		let t = p.get(e.id);
		if (!t) continue;
		let n = [];
		(Math.hypot(t.x - e.x, t.y - e.y) > .05 || t.level !== e.level) && n.push("position"), Math.abs(t.rot - e.rot) > .05 && n.push("rotation"), (Math.abs(t.w - e.w) > .05 || Math.abs(t.d - e.d) > .05 || Math.abs(t.h - e.h) > .05) && n.push("size"), (t.label !== e.label || t.kind !== e.kind) && n.push("type"), n.length && _.changed.push({
			id: e.id,
			label: e.label,
			kind: e.kind,
			what: n
		});
	}
	let v = [];
	for (let n of t.levels) {
		let t = e.levels.find((e) => e.id === n.id);
		if (!t) {
			v.push({
				id: n.id,
				what: ["added"]
			});
			continue;
		}
		let r = [];
		t.ceiling !== n.ceiling && r.push("ceiling"), t.floorThickness !== n.floorThickness && r.push("floor structure"), r.length && v.push({
			id: n.id,
			what: r
		});
	}
	return {
		walls: a,
		openings: c,
		rooms: f,
		items: _,
		levels: v,
		empty: !a.added.length && !a.removed.length && !a.moved.length && !c.added.length && !c.removed.length && !c.changed.length && !f.added.length && !f.removed.length && !f.renamed.length && !f.resized.length && !_.added.length && !_.removed.length && !_.changed.length && !v.length
	};
}
//#endregion
//#region src/model/units.ts
function v(e) {
	let t = e < 0 ? "-" : "", n = Math.round(Math.abs(e) * 8), r = Math.floor(n / 96);
	n -= r * 96;
	let i = Math.floor(n / 8), a = n - i * 8, o = "";
	if (a) {
		let e = 8;
		for (; a % 2 == 0;) a /= 2, e /= 2;
		o = ` ${a}/${e}`;
	}
	return `${t}${r}'-${i}${o}"`;
}
//#endregion
//#region src/model/types.ts
function y(e) {
	switch (e?.src) {
		case "sheet_dim":
		case "field":
		case "user": return "measured";
		case "sheet_raster":
		case "sheet_vector": return "traced";
		case "ai": return "velda";
		default: return "assumed";
	}
}
var b = {
	measured: 3,
	traced: 2,
	velda: 1,
	assumed: 0
};
function x(e) {
	return e.reduce((e, t) => b[t] < b[e] ? t : e, "measured");
}
//#endregion
//#region src/plan2d/geometry.ts
var S = (e) => {
	let t = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
	return [(e.b[0] - e.a[0]) / t, (e.b[1] - e.a[1]) / t];
}, C = (e) => {
	let t = S(e);
	return [t[1], -t[0]];
}, w = (e, t) => {
	let n = S(e);
	return [e.a[0] + n[0] * t, e.a[1] + n[1] * t];
}, T = (e, t) => {
	let n = S(e);
	return (t[0] - e.a[0]) * n[0] + (t[1] - e.a[1]) * n[1];
}, E = (e, t) => {
	let n = C(e);
	return (t[0] - e.a[0]) * n[0] + (t[1] - e.a[1]) * n[1];
}, D = (e) => e.tMeasured ?? e.t, O = (e) => e.map((e) => `${e[0].toFixed(2)},${e[1].toFixed(2)}`).join(" ");
function k(e) {
	let t = C(e), n = D(e) / 2;
	return [
		[e.a[0] + t[0] * n, e.a[1] + t[1] * n],
		[e.b[0] + t[0] * n, e.b[1] + t[1] * n],
		[e.b[0] - t[0] * n, e.b[1] - t[1] * n],
		[e.a[0] - t[0] * n, e.a[1] - t[1] * n]
	];
}
function ee(e, t) {
	let n = D(t) / 2 + .4, r = C(t), i = S(t), a = w(t, e.at - e.w / 2), o = w(t, e.at + e.w / 2), s = (e, t) => [e[0] + r[0] * t, e[1] + r[1] * t], c = [
		s(a, n),
		s(o, n),
		s(o, -n),
		s(a, -n)
	];
	if (e.kind === "window") {
		let e = D(t) / 2;
		return {
			gap: c,
			lines: [
				-e * .55,
				0,
				e * .55
			].map((e) => [s(a, e), s(o, e)])
		};
	}
	if (e.kind === "opening" || e.style === "cased") return {
		gap: c,
		lines: [],
		dashed: [[s(a, n), s(a, -n)], [s(o, n), s(o, -n)]]
	};
	if (e.style === "sliding" || e.style === "pocket" || e.style === "barn") {
		let n = Math.max(.75, D(t) * .22), r = w(t, e.at);
		return {
			gap: c,
			lines: e.style === "pocket" ? [[s(a, 0), s(r, 0)]] : [[s(a, n), s(w(t, e.at + e.w * .05), n)], [s(w(t, e.at - e.w * .05), -n), s(o, -n)]]
		};
	}
	let l = e.swing?.side === "right" ? -1 : 1;
	if (e.style === "french" || e.swing && e.w >= 60 && e.style !== "swing") {
		let i = e.w / 2, u = s(a, l * (n - .4)), d = s(o, l * (n - .4)), f = [u[0] + r[0] * l * i, u[1] + r[1] * l * i], p = [d[0] + r[0] * l * i, d[1] + r[1] * l * i], m = s(w(t, e.at), l * (n - .4)), h = l > 0 ? 0 : 1;
		return {
			gap: c,
			lines: [[u, f], [d, p]],
			arc: `M ${f[0]} ${f[1]} A ${i} ${i} 0 0 ${h} ${m[0]} ${m[1]} M ${p[0]} ${p[1]} A ${i} ${i} 0 0 ${1 - h} ${m[0]} ${m[1]}`
		};
	}
	let u = (e.swing?.hinge ?? "a") === "a", d = u ? a : o, f = u ? i : [-i[0], -i[1]], p = s(d, l * (n - .4)), m = [p[0] + r[0] * l * e.w, p[1] + r[1] * l * e.w], h = [p[0] + f[0] * e.w, p[1] + f[1] * e.w], g = l * (f[0] * r[1] - f[1] * r[0]);
	return {
		gap: c,
		lines: [[p, m]],
		arc: `M ${m[0]} ${m[1]} A ${e.w} ${e.w} 0 0 ${g > 0 ? 0 : 1} ${h[0]} ${h[1]}`
	};
}
function te(e) {
	return {
		at: e.polygon.length >= 3 ? p(e.polygon, 2) : e.labelAt ?? [0, 0],
		name: e.name,
		area: `${Math.round(u(e.polygon) / 144)} sf`
	};
}
var A = (e) => e ? x([y(e.prov.a), y(e.prov.b)]) : "assumed";
function j(e, t, n, r) {
	let i = [(n[0] + r[0]) / 2, (n[1] + r[1]) / 2], a = r[0] - n[0], s = r[1] - n[1], c = Math.hypot(a, s) || 1, l;
	for (let n of e.walls) {
		if (n.level !== t) continue;
		let e = S(n);
		if (Math.abs(e[0] * s / c - e[1] * a / c) > .05) continue;
		let r = T(n, i);
		if (r < -1 || r > o(n) + 1) continue;
		let u = Math.abs(Math.abs(E(n, i)) - D(n) / 2);
		u <= 1.5 && (!l || u < l.d) && (l = {
			w: n,
			d: u
		});
	}
	return l?.w;
}
function ne(e, t) {
	let n = t.polygon, r = [];
	if (n.length < 3) return r;
	let i = p(n, 2);
	for (let a = 0; a < n.length; a++) {
		let o = n[a], s = n[(a + 1) % n.length], c = Math.hypot(s[0] - o[0], s[1] - o[1]);
		if (c < 30) continue;
		let l = n[(a - 1 + n.length) % n.length], u = n[(a + 2) % n.length], d = j(e, t.level, l, o), f = j(e, t.level, s, u), p = x([A(d), A(f)]), m = [(o[0] + s[0]) / 2, (o[1] + s[1]) / 2], h = -(s[1] - o[1]) / c, g = (s[0] - o[0]) / c, _ = (i[0] - m[0]) * h + (i[1] - m[1]) * g > 0 ? 1 : -1, y = [m[0] + h * _ * 9, m[1] + g * _ * 9];
		r.push({
			a: o,
			b: s,
			length: c,
			text: v(c),
			badge: p,
			at: y,
			vertical: Math.abs(s[1] - o[1]) > Math.abs(s[0] - o[0])
		});
	}
	return r;
}
function re(e, t) {
	let n = e.walls.filter((e) => e.level === t && e.exterior), r = n.length ? n : e.walls.filter((e) => e.level === t);
	if (!r.length) return null;
	let i = d(r.flatMap((e) => k(e)));
	return {
		x0: i.x0,
		y0: i.y0,
		x1: i.x1,
		y1: i.y1
	};
}
//#endregion
//#region src/export/plan-svg.ts
var M = {
	measured: "#23282c",
	traced: "#a5670f",
	assumed: "#8a9297",
	velda: "#2f5f9e",
	conflict: "#9a3b2e"
}, ie = {
	measured: "measured (from the drawing or the field)",
	traced: "traced from the drawing, no dimension string",
	assumed: "assumed (a default)",
	velda: "set by Velda",
	conflict: "drawing and model disagree"
}, ae = (e) => e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), N = (e) => (Math.round(e * 100) / 100).toString(), P = (e) => v(e);
function F(e, t, n = 48) {
	let r = [
		...e.walls.filter((e) => e.level === t).flatMap((e) => k(e)),
		...e.rooms.filter((e) => e.level === t).flatMap((e) => e.polygon),
		...e.stairs.filter((e) => e.level === t || e.toLevel === t).flatMap((e) => e.polygon)
	];
	if (!r.length) return {
		x0: 0,
		y0: 0,
		x1: 240,
		y1: 240
	};
	let i = d(r);
	return {
		x0: i.x0 - n,
		y0: i.y0 - n,
		x1: i.x1 + n,
		y1: i.y1 + n
	};
}
function oe(e, t) {
	let n = t.level, r = t.text ?? 6, i = F(e, n, t.margin ?? 54), a = i.x1 - i.x0, o = i.y1 - i.y0, s = [], c = (e, t, n, r, i) => `<line x1="${N(e[0])}" y1="${N(e[1])}" x2="${N(t[0])}" y2="${N(t[1])}" stroke="${n}" stroke-width="${r}"${i ? ` stroke-dasharray="${i}"` : ""}/>`, l = (e, t, n, r, i = {}) => `<text x="${N(e[0])}" y="${N(e[1])}" font-family="helvetica" font-size="${N(n)}" fill="${r}" text-anchor="${i.anchor ?? "middle"}"${i.weight ? ` font-weight="${i.weight}"` : ""}${i.rotate ? ` transform="rotate(-90 ${N(e[0])} ${N(e[1])})"` : ""}>${ae(t)}</text>`, u = e.walls.filter((e) => e.level === n), f = e.rooms.filter((e) => e.level === n && e.polygon.length >= 3), p = t.base ? _(t.base, e) : null, m = new Set(p?.walls.added.map((e) => e.id) ?? []);
	for (let e of f) s.push(`<polygon points="${O(e.polygon)}" fill="${e.flags.includes("needs_confirming") ? "#f6e9f2" : "#ffffff"}" stroke="none"/>`);
	if (t.items !== !1) for (let t of e.items.filter((e) => e.level === n)) {
		let e = (t.label || t.kind.replace(/_/g, " ")).split(/,\s/)[0], n = Math.min(r * .75, Math.max(2.5, Math.min(t.w, t.d) * .28));
		s.push(`<g transform="translate(${N(t.x)} ${N(t.y)}) rotate(${N(-t.rot)})"><rect x="${N(-t.w / 2)}" y="${N(-t.d / 2)}" width="${N(t.w)}" height="${N(t.d)}" fill="#ffffff" stroke="#737d83" stroke-width="0.6"/>${t.w >= 14 && t.d >= 8 && e.length * n * .55 < t.w ? l([0, n * .35], e, n, "#4a5257") : ""}</g>`);
	}
	for (let e of u) {
		let t = e.kind === "glass" ? "#8fb3bb" : e.kind === "half" ? "#8a9297" : e.kind === "rail" ? "#ffffff" : e.exterior ? "#23282c" : "#4a5257", n = m.has(e.id) ? " stroke=\"#9a3b2e\" stroke-width=\"1.2\"" : e.kind === "rail" ? " stroke=\"#23282c\" stroke-width=\"0.6\"" : "";
		s.push(`<polygon points="${O(k(e))}" fill="${t}"${n}/>`);
	}
	if (t.base) for (let e of p.walls.removed.map((e) => e.id)) {
		let r = t.base.walls.find((t) => t.id === e);
		r && r.level === n && s.push(`<polygon points="${O(k(r))}" fill="none" stroke="#9a3b2e" stroke-width="1" stroke-dasharray="4 3"/>`);
	}
	let h = new Map(u.map((e) => [e.id, e]));
	for (let t of e.openings) {
		let e = h.get(t.wall);
		if (!e) continue;
		let n = ee(t, e);
		s.push(`<polygon points="${O(n.gap)}" fill="#ffffff"/>`);
		for (let [e, r] of n.lines) s.push(c(e, r, "#23282c", t.kind === "window" ? .6 : .8));
		for (let [e, t] of n.dashed ?? []) s.push(c(e, t, "#23282c", .6, "2 2"));
		n.arc && s.push(`<path d="${n.arc}" fill="none" stroke="#23282c" stroke-width="0.5" stroke-dasharray="3 2"/>`);
	}
	if (t.base) for (let e of p.walls.moved) {
		let n = h.get(e.id), i = t.base.walls.find((t) => t.id === e.id);
		if (!n || !i || !e.move || e.move < .5) continue;
		let a = [(i.a[0] + i.b[0]) / 2, (i.a[1] + i.b[1]) / 2], o = [(n.a[0] + n.b[0]) / 2, (n.a[1] + n.b[1]) / 2];
		s.push(c(a, o, "#9a3b2e", 1)), s.push(`<circle cx="${N(o[0])}" cy="${N(o[1])}" r="1.6" fill="#9a3b2e"/>`), s.push(l([o[0], o[1] - 3], `moved ${P(e.move)}`, r * .75, "#9a3b2e"));
	}
	for (let t of e.stairs.filter((e) => e.level === n || e.toLevel === n)) {
		s.push(`<polygon points="${O(t.polygon)}" fill="none" stroke="#4a5257" stroke-width="0.6" stroke-dasharray="6 3"/>`);
		let e = d(t.polygon), i = [(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2], a = Math.min(e.x1 - e.x0, e.y1 - e.y0) * .6 + Math.abs(t.up[0] * (e.x1 - e.x0) + t.up[1] * (e.y1 - e.y0)) * .3, o = [i[0] + t.up[0] * a * .5, i[1] + t.up[1] * a * .5];
		s.push(c([i[0] - t.up[0] * a * .5, i[1] - t.up[1] * a * .5], o, "#4a5257", .6)), s.push(l([i[0], i[1] + r * .3], t.level === n ? "UP" : "DN", r * .7, "#4a5257"));
	}
	for (let t of e.dimensions.filter((e) => e.level === n)) {
		if (!(t.source === "sheet" && t.status === "ok" || t.source === "user" || t.source === "field" || t.status === "conflict")) continue;
		let e = t.status === "conflict" ? M.conflict : t.source === "sheet" ? "#a9b0b4" : M.measured, n = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2], i = Math.abs(t.b[1] - t.a[1]) > Math.abs(t.b[0] - t.a[0]);
		s.push(c(t.a, t.b, e, .4)), s.push(l(i ? [n[0] - 1.5, n[1]] : [n[0], n[1] - 1.5], t.text, r * .62, e, { rotate: i }));
	}
	for (let t of f) for (let n of ne(e, t)) s.push(l(n.at, n.text, r * .7, M[n.badge], { rotate: n.vertical }));
	let g = re(e, n);
	if (g) {
		let e = g.y0 - 22, t = g.x0 - 22;
		s.push(c([g.x0, e], [g.x1, e], "#23282c", .5), c([g.x0, e - 4], [g.x0, e + 4], "#23282c", .5), c([g.x1, e - 4], [g.x1, e + 4], "#23282c", .5)), s.push(l([(g.x0 + g.x1) / 2, e - 3], P(g.x1 - g.x0), r * .8, "#23282c")), s.push(c([t, g.y0], [t, g.y1], "#23282c", .5), c([t - 4, g.y0], [t + 4, g.y0], "#23282c", .5), c([t - 4, g.y1], [t + 4, g.y1], "#23282c", .5)), s.push(l([t - 3, (g.y0 + g.y1) / 2], P(g.y1 - g.y0), r * .8, "#23282c", { rotate: !0 }));
	}
	for (let e of f) {
		let t = te(e);
		s.push(l(t.at, t.name, r, "#23282c", { weight: "bold" })), s.push(l([t.at[0], t.at[1] + r * 1.15], t.area, r * .75, "#4a5257"));
	}
	if (e.project.north !== null && e.project.north !== void 0) {
		let t = [i.x1 - 30, i.y0 + 34];
		s.push(`<g transform="translate(${N(t[0])} ${N(t[1])}) rotate(${N(e.project.north)})"><circle r="14" fill="none" stroke="#23282c" stroke-width="0.6"/><path d="M 0 -12 L 5 6 L 0 2 L -5 6 Z" fill="#23282c"/></g>`, l([t[0], t[1] + 24], "N", r * .8, "#23282c", { weight: "bold" }));
	}
	return {
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${N(i.x0)} ${N(i.y0)} ${N(a)} ${N(o)}" width="${N(a)}" height="${N(o)}">${s.join("")}</svg>`,
		bounds: i,
		w: a,
		h: o
	};
}
//#endregion
//#region src/lib/theme.ts
var se = [
	"walls",
	"trim",
	"cabinets",
	"island",
	"counters",
	"floors",
	"accent",
	"metal"
], ce = {
	walls: { color: "#f2eee6" },
	trim: { color: "#ece6da" },
	cabinets: { color: "#e8e2d6" },
	island: { color: "#e8e2d6" },
	counters: { color: "#efece6" },
	floors: { library: "wood-woodfine22" },
	accent: { color: "#b38b6d" },
	metal: { color: "#8c8c8c" }
}, I = {
	"flooring-woodparquet76": "herringbone, very light white oak",
	"wood-hungarianparquet10": "herringbone, honey oak",
	"wood-hungarianparquet2": "herringbone, dark red mahogany",
	"wood-woodparquet65": "basketweave parquet, honey",
	"wood-squareparquet21": "basketweave parquet, dark",
	"wood-woodparquet14": "wide plank, pale whitewashed oak",
	"wood-woodfine2": "plank, pale natural wood",
	"wood-woodfine22": "plank, light oak",
	"wood-floorplank1": "narrow strip, honey oak",
	"wood-woodplank19": "plank, weathered grey-brown",
	"wood-woodplank48": "plank, medium brown",
	"wood-woodenparquet11": "plank, dark walnut",
	"wood-finewood27": "smooth wood (butcher block)",
	"flooring-woodenceramic3": "wood-look tile, medium",
	"flooring-woodenceramic2": "wood-look tile, dark",
	"flooring-agedbrick": "brick, pale tan and worn",
	"flooring-rusticbrick": "brick, red with light mortar",
	"flooring-weatheredbrick": "brick, dark red",
	"flooring-wallstone1": "flagstone, honey sandstone",
	"flooring-statuarettowhite": "marble, white Statuario",
	"flooring-tile79": "marble, white with grey veining",
	"flooring-tile86": "marble checkerboard, grey and black",
	"flooring-terrazzo19": "encaustic cement tile, blue-green floral",
	"flooring-ceramic53": "encaustic tile, black and white pattern",
	"flooring-tiles3": "geometric tile, black and white triangles",
	"flooring-tile20": "large square tile, cream",
	"flooring-lightceramic24": "large square tile, light grey",
	"flooring-darkceramic22": "large square tile, dark slate",
	"flooring-tile85a": "slate, black",
	"concrete-polished": "polished concrete",
	"concrete-plaster": "painted plaster",
	"concrete-stucco": "white stucco",
	"metal-brass": "brass",
	"metal-chrome": "chrome",
	"metal-polished": "polished nickel / steel",
	"metal-steel": "brushed steel",
	"metal-copper": "copper"
};
function L(e, t) {
	return e?.data?.palette?.find((e) => (e.role || "").toLowerCase() === t);
}
function R(e, t) {
	let n = e?.data?.finishes?.[t];
	if (n?.library && I[n.library] || n?.color) return n;
	let r = L(e, t);
	if (r?.hex) return { color: r.hex };
	if (t === "island") return R(e, "cabinets");
	if (t === "trim") {
		let t = L(e, "walls");
		if (t?.hex) return { color: t.hex };
	}
	return ce[t];
}
//#endregion
//#region src/viewer/scene3d.ts
var z = .0254;
function B(e, t, n, r) {
	let i = r && e.themes[r] || (e.theme ? e.themes[e.theme] : void 0), a = (i?.data)?.finishes?.[t];
	return a?.color ? a.color : i?.data.palette?.find((e) => (e.role ?? "").toLowerCase() === t)?.hex ?? n;
}
function le(e, t, n) {
	let r = new e.Group(), i = [...t.levels].sort((e, t) => e.elev - t.elev), a = n.level ? i.filter((e) => e.id === n.level) : i, o = new e.MeshStandardMaterial({
		color: B(t, "walls", "#efebe4"),
		roughness: .9
	}), s = new e.MeshStandardMaterial({
		color: "#d9d4cb",
		roughness: .95
	}), c = new e.MeshStandardMaterial({
		color: "#9cc3cf",
		transparent: !0,
		opacity: .35,
		roughness: .1
	}), l = new e.MeshStandardMaterial({
		color: "#ffffff",
		roughness: .6
	}), u = new e.MeshStandardMaterial({
		color: "#4a5257",
		roughness: .7
	}), d = 0, f = r, p = (t, n, r, i, a, o, s, c, l = "") => {
		if (t <= .001 || n <= .001 || r <= .001) return;
		let u = new e.Mesh(new e.BoxGeometry(t, n, r), i);
		u.position.set(a, o, s), u.rotation.y = c, u.castShadow = !0, u.receiveShadow = !0, u.name = l, f.add(u), d++;
	}, m = new e.Box3();
	for (let i of a) {
		let a = i.elev * z, h = new e.Group();
		h.name = i.id, r.add(h), f = h;
		for (let n of t.rooms.filter((e) => e.level === i.id && e.polygon.length >= 3)) {
			let r = new e.Shape(n.polygon.map(([t, n]) => new e.Vector2(t * z, -n * z))), i = new e.ShapeGeometry(r);
			i.rotateX(-Math.PI / 2);
			let o = new e.Mesh(i, new e.MeshStandardMaterial({
				color: B(t, "floors", "#d8ccb6", n.theme),
				roughness: .8,
				side: e.DoubleSide
			}));
			o.position.y = a + .002, o.receiveShadow = !0, o.name = n.id, h.add(o), d++;
		}
		for (let r of t.walls.filter((e) => e.level === i.id)) {
			let l = r.b[0] - r.a[0], u = r.b[1] - r.a[1], d = Math.hypot(l, u);
			if (d < .5) continue;
			let g = r.kind === "half" ? 42 : r.h ?? i.ceiling, _ = n.cut ? Math.min(g, 42) : r.kind === "rail" ? 36 : g, v = Math.max(r.kind === "rail" ? 2 : .5, r.t), y = [l / d, u / d], b = -Math.atan2(u, l), x = r.kind === "glass" ? c : r.exterior ? s : o, S = (e, t, n) => {
				let i = r.a[0] + y[0] * e, o = r.a[1] + y[1] * e;
				return [
					i * z,
					a + (t + n) / 2 * z,
					o * z
				];
			}, C = (e, t, n, i) => {
				let a = Math.min(i, _);
				if (a <= n || t - e < .1) return;
				let [o, s, c] = S((e + t) / 2, n, a);
				p((t - e) * z, (a - n) * z, v * z, x, o, s, c, b, r.id);
			}, w = new e.Group();
			w.name = r.id, h.add(w), f = w;
			let T = t.openings.filter((e) => e.wall === r.id).sort((e, t) => e.at - t.at), E = 0;
			for (let e of T) {
				let t = Math.max(0, e.at - e.w / 2), r = Math.min(d, e.at + e.w / 2);
				C(E, t, 0, g);
				let i = e.kind === "window" ? e.sill ?? 36 : 0;
				if (C(t, r, 0, i), C(t, r, Math.min(e.h, g), g), e.kind === "window" && !n.cut) {
					let [n, a, o] = S((t + r) / 2, i, Math.min(e.h, g));
					p((r - t) * z, (Math.min(e.h, g) - i) * z, .4 * z, c, n, a, o, b, e.id);
				}
				E = Math.max(E, r);
			}
			C(E, d, 0, g), f = h, m.expandByPoint(new e.Vector3(r.a[0] * z, a, r.a[1] * z)), m.expandByPoint(new e.Vector3(r.b[0] * z, a + g * z, r.b[1] * z));
		}
		for (let e of t.items.filter((e) => e.level === i.id)) {
			let t = Math.max(1, e.h), r = e.z ?? 0, i = [
				"range",
				"fridge",
				"dishwasher",
				"oven_tower",
				"washer",
				"dryer"
			].includes(e.kind) ? u : l;
			p(e.w * z, (n.cut ? Math.min(t, Math.max(1, 42 - r)) : t) * z, e.d * z, i, e.x * z, a + (r + (n.cut ? Math.min(t, Math.max(1, 42 - r)) : t) / 2) * z, e.y * z, e.rot * Math.PI / 180, e.id);
		}
	}
	let h = new e.Vector3(), g = new e.Vector3();
	return m.isEmpty() && m.set(new e.Vector3(0, 0, 0), new e.Vector3(10, 3, 10)), m.getCenter(h), m.getSize(g), {
		group: r,
		center: h,
		size: Math.max(g.x, g.z, 4),
		meshes: d
	};
}
//#endregion
//#region src/viewer/viewer.css?raw
var V = "/* The share viewer: the studio's look, read-only. */\n#velda-viewer { display: flex; flex-direction: column; height: 100%; }\n.vw-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 12px 18px; border-bottom: 1px solid #e3e1db; background: #fbfbf8; }\n.vw-title { display: flex; flex-direction: column; margin-right: auto; }\n.vw-title strong { font: 400 22px/1.1 Georgia, \"Times New Roman\", serif; }\n.muted { color: #737d83; }\n.vw-head button, .vw-tabs button { border: 1px solid #d9d6cf; background: #fff; border-radius: 999px; padding: 4px 12px; font: inherit; color: #4a5257; cursor: pointer; }\n.vw-head button[aria-pressed='true'], .vw-tabs button[aria-selected='true'] { background: #e4efec; border-color: #2e6b62; color: #2e6b62; }\n.vw-levels, .vw-views { display: flex; gap: 6px; }\n.vw-scheme select { font: inherit; padding: 3px 6px; }\n.vw-body { flex: 1; display: grid; grid-template-columns: 1fr 340px; min-height: 0; }\n.vw-stage { position: relative; min-height: 0; display: flex; flex-direction: column; }\n.vw-plan { flex: 1; min-height: 0; cursor: grab; touch-action: none; }\n.vw-plan:active { cursor: grabbing; }\n.vw-3d { flex: 1; min-height: 0; }\n.vw-3d canvas { display: block; width: 100%; height: 100%; }\n.vw-intent { margin: 0; padding: 6px 14px; font-size: 12px; font-weight: 600; color: #9a3b2e; border-top: 1px solid #e3e1db; }\n.vw-legend { position: absolute; left: 12px; bottom: 40px; margin: 0; padding: 8px 10px; list-style: none; background: rgba(251,251,248,.92); border: 1px solid #e3e1db; border-radius: 8px; font-size: 12px; }\n.vw-legend li, .vw-sw li { display: flex; align-items: center; gap: 6px; }\n.sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(0,0,0,.12); }\n.vw-pin circle { fill: #2e6b62; stroke: #fff; stroke-width: 2; cursor: pointer; }\n.vw-pin text { fill: #fff; pointer-events: none; }\n.vw-pin.is-on circle { fill: #9a3b2e; }\n.vw-pin.is-resolved circle { fill: #8a9297; }\n.vw-side { border-left: 1px solid #e3e1db; display: flex; flex-direction: column; min-height: 0; background: #fbfbf8; }\n.vw-tabs { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #e3e1db; }\n.vw-panel { overflow: auto; padding: 12px 14px; }\n.vw-comment { border: 1px solid #e3e1db; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; background: #fff; cursor: pointer; }\n.vw-comment.is-on { border-color: #9a3b2e; }\n.vw-comment p, .vw-reply p { margin: 4px 0 0; }\n.vw-reply { margin: 8px 0 0 12px; padding-left: 8px; border-left: 2px solid #e3e1db; }\n.vw-meta { font-size: 12px; color: #737d83; display: flex; gap: 6px; align-items: center; }\n.vw-num { background: #2e6b62; color: #fff; border-radius: 999px; min-width: 18px; text-align: center; font-size: 11px; }\n.vw-mood { border-bottom: 1px solid #e3e1db; padding-bottom: 12px; margin-bottom: 12px; }\n.vw-mood h3 { margin: 0; font: 400 20px Georgia, serif; }\n.vw-sw, .vw-mat { list-style: none; padding: 0; margin: 8px 0; font-size: 13px; display: grid; gap: 3px; }\n.vw-sw code { color: #737d83; font-size: 11px; }\n.vw-pics { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }\n.vw-pics li { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }\n.vw-pics img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }\n.vw-chips { display: flex; height: 64px; border-radius: 6px; overflow: hidden; }\n.vw-chips span { flex: 1; }\n.vw-cap { color: #4a5257; }\n.vw-pics a { color: #2e6b62; }\n@media (max-width: 760px) { .vw-body { grid-template-columns: 1fr; grid-template-rows: 60vh auto; } .vw-side { border-left: 0; border-top: 1px solid #e3e1db; } }\n", H = JSON.parse(document.getElementById("velda-data").textContent || "{}"), U = document.getElementById("velda-viewer"), W = document.createElement("style");
W.textContent = V, document.head.appendChild(W);
var G = (e, t = {}, ...n) => {
	let r = document.createElement(e);
	for (let [e, n] of Object.entries(t)) n != null && n !== !1 && (e.startsWith("on") && typeof n == "function" ? r.addEventListener(e.slice(2).toLowerCase(), n) : e === "class" ? r.className = n : r.setAttribute(e, n === !0 ? "" : String(n)));
	for (let e of n) e != null && e !== !1 && r.append(e);
	return r;
}, K = (e) => v(e), q = (e) => [...e.levels].sort((e, t) => e.elev - t.elev).find((t) => e.walls.some((e) => e.level === t.id))?.id ?? e.levels[0]?.id ?? null, J = {
	scheme: Math.max(0, H.schemes.findIndex((e) => !e.asBuilt)),
	level: null,
	view: "plan",
	cut: !0,
	tab: "comments",
	pin: null
};
J.level = q(H.schemes[J.scheme].model);
var Y = () => H.schemes[J.scheme], X = {
	meshes: 0,
	view: "plan",
	level: J.level
};
window.__viewer = X;
function Z() {
	U.replaceChildren(ue(), G("div", { class: "vw-body" }, de(), $())), X.view = J.view, X.level = J.level;
}
function ue() {
	let e = Y(), t = [...e.model.levels].sort((e, t) => e.elev - t.elev).filter((t) => e.model.walls.some((e) => e.level === t.id));
	return G("header", { class: "vw-head" }, G("div", { class: "vw-title" }, G("strong", {}, H.project.name), H.project.address ? G("span", { class: "muted" }, H.project.address) : null), H.schemes.length > 1 ? G("label", { class: "vw-scheme" }, "Scheme ", (() => {
		let e = G("select", {
			"aria-label": "Scheme",
			onchange: (e) => (J.scheme = Number(e.target.value), J.level = q(Y().model) ?? J.level, J.pin = null, Z())
		});
		return H.schemes.forEach((t, n) => e.append(G("option", {
			value: n,
			selected: n === J.scheme
		}, `${t.name}${t.asBuilt ? " (as-built)" : ""}`))), e;
	})()) : G("span", { class: "vw-scheme" }, e.name), G("nav", {
		class: "vw-levels",
		"aria-label": "Level"
	}, ...J.view === "3d" && t.length > 1 ? [G("button", {
		"aria-pressed": J.level === null,
		onclick: () => (J.level = null, Z())
	}, "Whole house")] : [], ...t.map((e) => G("button", {
		"aria-pressed": J.level === e.id,
		onclick: () => (J.level = e.id, Z())
	}, e.name))), G("div", {
		class: "vw-views",
		role: "group",
		"aria-label": "View"
	}, G("button", {
		"aria-pressed": J.view === "plan",
		onclick: () => (J.view = "plan", J.level = J.level ?? q(Y().model), Z())
	}, "Plan"), G("button", {
		"aria-pressed": J.view === "3d",
		onclick: () => (J.view = "3d", Z())
	}, "3D"), J.view === "3d" ? G("button", {
		"aria-pressed": J.cut,
		onclick: () => (J.cut = !J.cut, Z())
	}, J.cut ? "Walls cut away" : "Walls full height") : null));
}
function de() {
	let e = G("main", { class: "vw-stage" });
	return J.view === "plan" ? fe(e) : me(e), e.append(G("p", { class: "vw-intent" }, H.intent)), e;
}
function fe(e) {
	let t = Y(), n = J.level ?? q(t.model);
	if (!n) return;
	let r = oe(t.model, {
		level: n,
		text: 9
	}), i = G("div", { class: "vw-plan" });
	i.innerHTML = r.svg;
	let a = i.querySelector("svg");
	a.setAttribute("width", "100%"), a.setAttribute("height", "100%"), a.setAttribute("role", "img"), a.setAttribute("aria-label", `${t.model.levels.find((e) => e.id === n)?.name ?? ""} plan`), t.comments.filter((e) => e.level === n).forEach((e, t) => {
		let n = document.createElementNS("http://www.w3.org/2000/svg", "g");
		n.setAttribute("class", `vw-pin${J.pin === e.id ? " is-on" : ""}${e.resolved ? " is-resolved" : ""}`), n.setAttribute("data-id", e.id), n.setAttribute("transform", `translate(${e.at[0]} ${e.at[1]})`), n.innerHTML = `<circle r="9"></circle><text y="3.5" text-anchor="middle" font-size="10" font-family="helvetica">${t + 1}</text>`, n.addEventListener("click", (t) => {
			t.stopPropagation(), J.pin = e.id, J.tab = "comments", Z();
		}), a.append(n);
	});
	let o = r.bounds ? [
		r.bounds.x0,
		r.bounds.y0,
		r.w,
		r.h
	] : [
		0,
		0,
		100,
		100
	], s = () => a.setAttribute("viewBox", o.map((e) => e.toFixed(2)).join(" "));
	i.addEventListener("wheel", (e) => {
		e.preventDefault();
		let t = a.getBoundingClientRect(), n = Math.exp(e.deltaY * .0015), r = Math.max(o[2] / t.width, o[3] / t.height), i = o[0] + (e.clientX - t.left - (t.width - o[2] / r) / 2) * r, c = o[1] + (e.clientY - t.top - (t.height - o[3] / r) / 2) * r;
		o = [
			i - (i - o[0]) * n,
			c - (c - o[1]) * n,
			o[2] * n,
			o[3] * n
		], s();
	}, { passive: !1 });
	let c = null;
	i.addEventListener("pointerdown", (e) => {
		e.target.closest(".vw-pin") || (c = {
			x: e.clientX,
			y: e.clientY,
			vb: [...o]
		}, i.setPointerCapture(e.pointerId));
	}), i.addEventListener("pointermove", (e) => {
		if (!c) return;
		let t = a.getBoundingClientRect(), n = Math.max(c.vb[2] / t.width, c.vb[3] / t.height);
		o = [
			c.vb[0] - (e.clientX - c.x) * n,
			c.vb[1] - (e.clientY - c.y) * n,
			c.vb[2],
			c.vb[3]
		], s();
	}), i.addEventListener("pointerup", () => c = null), e.append(i, pe());
}
function pe() {
	return G("ul", {
		class: "vw-legend",
		"aria-label": "Where the numbers came from"
	}, ...[
		"measured",
		"traced",
		"assumed",
		"velda",
		"conflict"
	].map((e) => G("li", {}, G("span", {
		class: "sw",
		style: `background:${M[e]}`
	}), ie[e])));
}
var Q = null;
async function me(e) {
	let t = G("div", { class: "vw-3d" }, G("p", { class: "muted" }, "Loading the 3D view..."));
	e.append(t);
	try {
		let e = await import("three"), { OrbitControls: n } = await import("three/addons/controls/OrbitControls.js"), r = le(e, Y().model, {
			level: J.level,
			cut: J.cut
		});
		X.meshes = r.meshes;
		let i = new e.Scene();
		i.background = new e.Color("#f3f1ec"), i.add(new e.HemisphereLight("#ffffff", "#bdb7aa", 1.6));
		let a = new e.DirectionalLight("#ffffff", 1.4);
		a.position.set(r.center.x + r.size, r.size * 1.2, r.center.z + r.size * .6), i.add(a), i.add(r.group);
		let o = t.clientWidth || 800, s = t.clientHeight || 600, c = new e.PerspectiveCamera(45, o / s, .05, 500), l = r.size * 1.15;
		c.position.set(r.center.x + l * .35, r.center.y + l * .8, r.center.z + l * .9), Q?.dispose?.(), Q = new e.WebGLRenderer({
			antialias: !0,
			preserveDrawingBuffer: !0
		}), Q.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)), Q.setSize(o, s), t.replaceChildren(Q.domElement);
		let u = new n(c, Q.domElement);
		u.target.copy(r.center), u.update();
		let d = () => {
			Q.domElement.isConnected && (Q.render(i, c), requestAnimationFrame(d));
		};
		d(), new ResizeObserver(() => {
			let e = t.clientWidth, n = t.clientHeight;
			e && n && (c.aspect = e / n, c.updateProjectionMatrix(), Q.setSize(e, n));
		}).observe(t);
	} catch (e) {
		t.replaceChildren(G("p", { class: "muted" }, `The 3D view needs a connection to cdn.jsdelivr.net (${String(e).slice(0, 80)}).`));
	}
}
function $() {
	let e = Y(), t = G("div", {
		class: "vw-tabs",
		role: "tablist"
	}, ...[
		["comments", `Comments (${e.comments.length})`],
		["mood", "Mood boards"],
		["info", "About"]
	].map(([e, t]) => G("button", {
		role: "tab",
		"aria-selected": J.tab === e,
		onclick: () => (J.tab = e, Z())
	}, t))), n = G("div", { class: "vw-panel" });
	return J.tab === "comments" ? n.append(...he(e)) : J.tab === "mood" ? n.append(...ge(e.model)) : n.append(...ye(e)), G("aside", { class: "vw-side" }, t, n);
}
function he(e) {
	if (!e.comments.length) return [G("p", { class: "muted" }, "No comments on this scheme.")];
	let t = (t) => e.model.levels.find((e) => e.id === t)?.name ?? t, n = /* @__PURE__ */ new Map();
	return e.comments.map((e) => {
		let r = (n.get(e.level) ?? 0) + 1;
		return n.set(e.level, r), G("article", {
			class: `vw-comment${J.pin === e.id ? " is-on" : ""}${e.resolved ? " is-resolved" : ""}`,
			"data-id": e.id,
			onclick: () => (J.pin = e.id, J.level = e.level, J.view = "plan", Z())
		}, G("div", { class: "vw-meta" }, G("span", { class: "vw-num" }, String(r)), `${t(e.level)} · ${e.author} · ${e.created_at.slice(0, 10)}${e.resolved ? " · resolved" : ""}`), G("p", {}, e.body), ...e.replies.map((e) => G("div", { class: "vw-reply" }, G("div", { class: "vw-meta" }, `${e.author} · ${e.created_at.slice(0, 10)}`), G("p", {}, e.body))));
	});
}
function ge(e) {
	let t = e.rooms.filter((t) => t.polygon.length >= 3 && (t.theme || e.inspiration.some((e) => e.rooms.includes(t.id))));
	return t.length ? t.map((t) => _e(e, t)) : [G("p", { class: "muted" }, "No mood boards yet: no room has a theme or inspiration in this scheme.")];
}
function _e(e, t) {
	let n = t.theme && e.themes[t.theme] || (e.theme ? e.themes[e.theme] : null), r = d(t.polygon), i = e.inspiration.filter((e) => e.rooms.includes(t.id) && e.kind !== "board").slice(0, 12), a = [];
	if (n) for (let e of se) {
		let t = L(n, e), r = R(n, e);
		if (!t && !n.data.finishes?.[e]) continue;
		let i = r.color ?? t?.hex ?? "#ddd";
		a.push(G("li", {}, G("span", {
			class: "sw",
			style: `background:${i}`
		}), G("strong", {}, e), ` ${t?.name ?? ""} `, G("code", {}, i)));
	}
	return G("section", { class: "vw-mood" }, G("h3", {}, t.name), G("p", { class: "muted" }, `${K(r.x1 - r.x0)} x ${K(r.y1 - r.y0)}, ${Math.round(u(t.polygon) / 144)} sf`), n ? G("p", {}, G("strong", {}, n.name), n.data.description ? ` ${n.data.description}` : "") : null, a.length ? G("ul", { class: "vw-sw" }, ...a) : null, n?.data.materials?.length ? G("ul", { class: "vw-mat" }, ...n.data.materials.map((e) => G("li", {}, G("strong", {}, e.category), ` ${e.choice}`))) : null, i.length ? G("ul", { class: "vw-pics" }, ...i.map(ve)) : null);
}
function ve(e) {
	let t = H.thumbs[e.id], n = e.url ?? (e.image && /^https?:/.test(e.image) ? e.image : void 0), r = (e.tags.palette.length ? e.tags.palette : e.sampled ?? []).slice(0, 5);
	return G("li", {}, t ? G("img", {
		src: t,
		alt: e.title ?? "inspiration",
		loading: "lazy"
	}) : G("div", { class: "vw-chips" }, ...r.map((e) => G("span", {
		style: `background:${e.hex}`,
		title: e.hex
	}))), G("span", { class: "vw-cap" }, e.title ?? e.kind), n ? G("a", {
		href: n,
		target: "_blank",
		rel: "noreferrer noopener"
	}, e.source ?? "link") : null);
}
function ye(e) {
	return [
		G("p", {}, G("strong", {}, e.name), e.asBuilt ? " (the house as it is today)" : ""),
		G("p", { class: "muted" }, `${e.version}, ${e.date}`),
		G("p", {}, H.intent),
		G("p", { class: "muted" }, `Shared ${H.created.slice(0, 10)} from Velda Studio. This page is read-only.`)
	];
}
Z();
//#endregion
