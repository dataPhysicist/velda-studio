var e = (e, t) => [e[0] - t[0], e[1] - t[1]], t = (e, t) => [e[0] + t[0], e[1] + t[1]], n = (e, t) => [e[0] * t, e[1] * t], r = (e, t) => e[0] * t[0] + e[1] * t[1], i = (e, t) => Math.hypot(e[0] - t[0], e[1] - t[1]), a = (e, t, n) => [e[0] + (t[0] - e[0]) * n, e[1] + (t[1] - e[1]) * n], o = (e) => Math.round(e * 100) / 100, s = (e) => [o(e[0]), o(e[1])];
function c(e) {
	return i(e.a, e.b);
}
function l(e) {
	let t = c(e);
	return t < 1e-9 ? [1, 0] : [(e.b[0] - e.a[0]) / t, (e.b[1] - e.a[1]) / t];
}
function u(e) {
	let [t, n] = l(e);
	return [n, -t];
}
function d(e, t) {
	let n = l(e);
	return [e.a[0] + n[0] * t, e.a[1] + n[1] * t];
}
function f(t, n, o) {
	let s = e(o, n), c = r(s, s);
	return c < 1e-9 ? i(t, n) : i(t, a(n, o, Math.max(0, Math.min(1, r(e(t, n), s) / c))));
}
function p(e, t) {
	let n = !1;
	for (let r = 0, i = t.length - 1; r < t.length; i = r++) {
		let [a, o] = t[r], [s, c] = t[i];
		o > e[1] != c > e[1] && e[0] < (s - a) * (e[1] - o) / (c - o) + a && (n = !n);
	}
	return n;
}
function m(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) {
		let r = e[n], i = e[(n + 1) % e.length];
		t += r[0] * i[1] - i[0] * r[1];
	}
	return t / 2;
}
var h = (e) => Math.abs(m(e));
function g(e) {
	let t = Infinity, n = Infinity, r = -Infinity, i = -Infinity;
	for (let [a, o] of e) a < t && (t = a), o < n && (n = o), a > r && (r = a), o > i && (i = o);
	return {
		x0: t,
		y0: n,
		x1: r,
		y1: i
	};
}
function _(e) {
	let t = m(e);
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
function v(e, t = 1) {
	let n = g(e), r = (t) => {
		let n = Infinity;
		for (let r = 0; r < e.length; r++) n = Math.min(n, f(t, e[r], e[(r + 1) % e.length]));
		return p(t, e) ? n : -n;
	}, i = _(e), a = r(i), o = Math.max(n.x1 - n.x0, n.y1 - n.y0) / 8, c = (n.x0 + n.x1) / 2, l = (n.y0 + n.y1) / 2, u = Math.max(n.x1 - n.x0, n.y1 - n.y0);
	for (; o >= t;) {
		for (let e = c - u / 2; e <= c + u / 2; e += o) for (let t = l - u / 2; t <= l + u / 2; t += o) {
			let n = r([e, t]);
			n > a && (a = n, i = [e, t]);
		}
		c = i[0], l = i[1], u = o * 2, o /= 2;
	}
	return s(i);
}
//#endregion
//#region src/model/diff.ts
var y = (e, t) => ({
	id: e.id,
	level: e.level,
	length: b(c(e)),
	...t === void 0 ? {} : { move: b(t) },
	bearing: e.bearing,
	exterior: e.exterior
}), b = (e) => Math.round(e * 100) / 100, x = (e) => Math.round(h(e.polygon) / 144);
function S(e, t) {
	let n = new Map(e.walls.map((e) => [e.id, e])), r = new Map(t.walls.map((e) => [e.id, e])), a = {
		added: [],
		removed: [],
		moved: []
	};
	for (let e of t.walls) n.has(e.id) || a.added.push(y(e));
	for (let t of e.walls) r.has(t.id) || a.removed.push(y(t));
	for (let e of t.walls) {
		let t = n.get(e.id);
		if (!t) continue;
		let r = Math.max(i(t.a, e.a), i(t.b, e.b));
		(r > .05 || Math.abs(t.t - e.t) > .05) && a.moved.push(y(e, r));
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
		areaAfter: x(e)
	});
	for (let t of e.rooms) d.has(t.id) || f.removed.push({
		id: t.id,
		name: t.name,
		areaBefore: x(t)
	});
	for (let e of t.rooms) {
		let t = u.get(e.id);
		t && (t.name !== e.name && f.renamed.push({
			id: e.id,
			name: e.name,
			was: t.name
		}), x(t) !== x(e) && f.resized.push({
			id: e.id,
			name: e.name,
			areaBefore: x(t),
			areaAfter: x(e)
		}));
	}
	let p = new Map(e.items.map((e) => [e.id, e])), m = new Map(t.items.map((e) => [e.id, e])), h = {
		added: [],
		removed: [],
		changed: []
	};
	for (let e of t.items) p.has(e.id) || h.added.push({
		id: e.id,
		label: e.label,
		kind: e.kind,
		what: []
	});
	for (let t of e.items) m.has(t.id) || h.removed.push({
		id: t.id,
		label: t.label,
		kind: t.kind,
		what: []
	});
	for (let e of t.items) {
		let t = p.get(e.id);
		if (!t) continue;
		let n = [];
		(Math.hypot(t.x - e.x, t.y - e.y) > .05 || t.level !== e.level) && n.push("position"), Math.abs(t.rot - e.rot) > .05 && n.push("rotation"), (Math.abs(t.w - e.w) > .05 || Math.abs(t.d - e.d) > .05 || Math.abs(t.h - e.h) > .05) && n.push("size"), (t.label !== e.label || t.kind !== e.kind) && n.push("type"), n.length && h.changed.push({
			id: e.id,
			label: e.label,
			kind: e.kind,
			what: n
		});
	}
	let g = [];
	for (let n of t.levels) {
		let t = e.levels.find((e) => e.id === n.id);
		if (!t) {
			g.push({
				id: n.id,
				what: ["added"]
			});
			continue;
		}
		let r = [];
		t.ceiling !== n.ceiling && r.push("ceiling"), t.floorThickness !== n.floorThickness && r.push("floor structure"), r.length && g.push({
			id: n.id,
			what: r
		});
	}
	return {
		walls: a,
		openings: c,
		rooms: f,
		items: h,
		levels: g,
		empty: !a.added.length && !a.removed.length && !a.moved.length && !c.added.length && !c.removed.length && !c.changed.length && !f.added.length && !f.removed.length && !f.renamed.length && !f.resized.length && !h.added.length && !h.removed.length && !h.changed.length && !g.length
	};
}
//#endregion
//#region src/model/units.ts
function C(e) {
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
function w(e) {
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
var T = {
	measured: 3,
	traced: 2,
	velda: 1,
	assumed: 0
};
function E(e) {
	return e.reduce((e, t) => T[t] < T[e] ? t : e, "measured");
}
//#endregion
//#region src/model/derive.ts
var ee = (e) => {
	let t = Math.hypot(e[0], e[1]);
	return t < 1e-9 ? [0, 0] : [e[0] / t, e[1] / t];
};
function te(i, a, o) {
	let s = a.binds[o];
	if (!s) return null;
	let c = ee(e(a.b, a.a));
	if (s.kind === "wall_face" || s.kind === "wall_center") {
		let o = i.walls.find((e) => e.id === s.id);
		if (!o || Math.abs(r(l(o), c)) > .1) return null;
		let d = u(o), f = o.a;
		return s.kind === "wall_face" && (f = t(o.a, n(d, (s.which === "left" ? 1 : -1) * ((o.tMeasured ?? o.t) / 2)))), r(e(f, a.a), c);
	}
	let f = i.openings.find((e) => e.id === s.id), p = f && i.walls.find((e) => e.id === f.wall);
	return !f || !p ? null : r(e(d(p, s.which === "a" ? f.at - f.w / 2 : f.at + f.w / 2), a.a), c);
}
//#endregion
//#region src/plan2d/geometry.ts
var D = (e) => {
	let t = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
	return [(e.b[0] - e.a[0]) / t, (e.b[1] - e.a[1]) / t];
}, O = (e) => {
	let t = D(e);
	return [t[1], -t[0]];
}, k = (e, t) => {
	let n = D(e);
	return [e.a[0] + n[0] * t, e.a[1] + n[1] * t];
}, ne = (e, t) => {
	let n = D(e);
	return (t[0] - e.a[0]) * n[0] + (t[1] - e.a[1]) * n[1];
}, re = (e, t) => {
	let n = O(e);
	return (t[0] - e.a[0]) * n[0] + (t[1] - e.a[1]) * n[1];
}, A = (e) => e.tMeasured ?? e.t, j = (e) => e.map((e) => `${e[0].toFixed(2)},${e[1].toFixed(2)}`).join(" ");
function M(e) {
	let t = O(e), n = A(e) / 2;
	return [
		[e.a[0] + t[0] * n, e.a[1] + t[1] * n],
		[e.b[0] + t[0] * n, e.b[1] + t[1] * n],
		[e.b[0] - t[0] * n, e.b[1] - t[1] * n],
		[e.a[0] - t[0] * n, e.a[1] - t[1] * n]
	];
}
function ie(e, t) {
	let n = A(t) / 2 + .4, r = O(t), i = D(t), a = k(t, e.at - e.w / 2), o = k(t, e.at + e.w / 2), s = (e, t) => [e[0] + r[0] * t, e[1] + r[1] * t], c = [
		s(a, n),
		s(o, n),
		s(o, -n),
		s(a, -n)
	];
	if (e.kind === "window") {
		let e = A(t) / 2;
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
		let n = Math.max(.75, A(t) * .22), r = k(t, e.at);
		return {
			gap: c,
			lines: e.style === "pocket" ? [[s(a, 0), s(r, 0)]] : [[s(a, n), s(k(t, e.at + e.w * .05), n)], [s(k(t, e.at - e.w * .05), -n), s(o, -n)]]
		};
	}
	let l = e.swing?.side === "right" ? -1 : 1;
	if (e.style === "french" || e.swing && e.w >= 60 && e.style !== "swing") {
		let i = e.w / 2, u = s(a, l * (n - .4)), d = s(o, l * (n - .4)), f = [u[0] + r[0] * l * i, u[1] + r[1] * l * i], p = [d[0] + r[0] * l * i, d[1] + r[1] * l * i], m = s(k(t, e.at), l * (n - .4)), h = l > 0 ? 0 : 1;
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
function ae(e) {
	return {
		at: e.polygon.length >= 3 ? v(e.polygon, 2) : e.labelAt ?? [0, 0],
		name: e.name,
		area: `${Math.round(h(e.polygon) / 144)} sf`
	};
}
var N = (e) => e ? E([w(e.prov.a), w(e.prov.b)]) : "assumed";
function P(e, t, n, r) {
	let i = [(n[0] + r[0]) / 2, (n[1] + r[1]) / 2], a = r[0] - n[0], o = r[1] - n[1], s = Math.hypot(a, o) || 1, l;
	for (let n of e.walls) {
		if (n.level !== t) continue;
		let e = D(n);
		if (Math.abs(e[0] * o / s - e[1] * a / s) > .05) continue;
		let r = ne(n, i);
		if (r < -1 || r > c(n) + 1) continue;
		let u = Math.abs(Math.abs(re(n, i)) - A(n) / 2);
		u <= 1.5 && (!l || u < l.d) && (l = {
			w: n,
			d: u
		});
	}
	return l?.w;
}
function oe(e, t) {
	let n = t.polygon, r = [];
	if (n.length < 3) return r;
	let i = 0;
	for (let e = 0; e < n.length; e++) {
		let t = n[e], r = n[(e + 1) % n.length];
		i += t[0] * r[1] - r[0] * t[1];
	}
	let a = i > 0 ? 1 : -1;
	for (let i = 0; i < n.length; i++) {
		let o = n[i], s = n[(i + 1) % n.length], c = Math.hypot(s[0] - o[0], s[1] - o[1]);
		if (c < 30) continue;
		let l = n[(i - 1 + n.length) % n.length], u = n[(i + 2) % n.length], d = P(e, t.level, l, o), f = P(e, t.level, s, u), p = E([N(d), N(f)]), m = [(o[0] + s[0]) / 2, (o[1] + s[1]) / 2], h = -(s[1] - o[1]) / c, g = (s[0] - o[0]) / c, _ = a, v = [m[0] + h * _ * 9, m[1] + g * _ * 9];
		r.push({
			a: o,
			b: s,
			length: c,
			text: C(c),
			badge: p,
			at: v,
			vertical: Math.abs(s[1] - o[1]) > Math.abs(s[0] - o[0])
		});
	}
	return r;
}
function se(e, t) {
	let n = e.walls.filter((e) => e.level === t && e.exterior), r = n.length ? n : e.walls.filter((e) => e.level === t);
	if (!r.length) return null;
	let i = g(r.flatMap((e) => M(e)));
	return {
		x0: i.x0,
		y0: i.y0,
		x1: i.x1,
		y1: i.y1
	};
}
function ce(e, t) {
	if (t.status !== "conflict") return {
		text: t.text,
		title: t.text
	};
	let n = te(e, t, 0), r = te(e, t, 1), i = n !== null && r !== null ? C(Math.abs(r - n)) : null, a = t.source === "sheet" ? "drawn" : "measured";
	return {
		text: i ? `${t.text} ${a}, ${i} now` : t.text,
		title: i ? `The ${t.source === "sheet" ? "drawing says" : "tape measured"} ${t.text}; the walls measure ${i} now.` : t.text
	};
}
//#endregion
//#region src/export/plan-svg.ts
var F = {
	measured: "#23282c",
	traced: "#a5670f",
	assumed: "#8a9297",
	velda: "#2f5f9e",
	conflict: "#9a3b2e"
}, le = {
	measured: "measured (from the drawing or the field)",
	traced: "traced from the drawing, no dimension string",
	assumed: "assumed (a default)",
	velda: "set by Velda",
	conflict: "drawing and model disagree"
}, I = (e) => e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), L = (e) => (Math.round(e * 100) / 100).toString(), R = (e) => C(e);
function ue(e, t, n = 48) {
	let r = [
		...e.walls.filter((e) => e.level === t).flatMap((e) => M(e)),
		...e.rooms.filter((e) => e.level === t).flatMap((e) => e.polygon),
		...e.stairs.filter((e) => e.level === t || e.toLevel === t).flatMap((e) => e.polygon)
	];
	if (!r.length) return {
		x0: 0,
		y0: 0,
		x1: 240,
		y1: 240
	};
	let i = g(r);
	return {
		x0: i.x0 - n,
		y0: i.y0 - n,
		x1: i.x1 + n,
		y1: i.y1 + n
	};
}
function de(e, t) {
	let n = t.level, r = t.text ?? 6, i = ue(e, n, t.margin ?? 54), a = i.x1 - i.x0, o = i.y1 - i.y0, s = [], c = (e, t, n, r, i) => `<line x1="${L(e[0])}" y1="${L(e[1])}" x2="${L(t[0])}" y2="${L(t[1])}" stroke="${n}" stroke-width="${r}"${i ? ` stroke-dasharray="${i}"` : ""}/>`, l = (e, t, n, r, i = {}) => `<text x="${L(e[0])}" y="${L(e[1])}" font-family="helvetica" font-size="${L(n)}" fill="${r}" text-anchor="${i.anchor ?? "middle"}"${i.weight ? ` font-weight="${i.weight}"` : ""}${i.rotate ? ` transform="rotate(-90 ${L(e[0])} ${L(e[1])})"` : ""}>${I(t)}</text>`, u = e.walls.filter((e) => e.level === n), d = e.rooms.filter((e) => e.level === n && e.polygon.length >= 3), f = t.base ? S(t.base, e) : null, p = new Set(f?.walls.added.map((e) => e.id) ?? []);
	for (let e of d) s.push(`<polygon points="${j(e.polygon)}" fill="${e.flags.includes("needs_confirming") ? "#f6e9f2" : "#ffffff"}" stroke="none"/>`);
	if (t.items !== !1) for (let t of e.items.filter((e) => e.level === n)) {
		let e = (t.label || t.kind.replace(/_/g, " ")).split(/,\s/)[0], n = Math.min(r * .75, Math.max(2.5, Math.min(t.w, t.d) * .28));
		s.push(`<g transform="translate(${L(t.x)} ${L(t.y)}) rotate(${L(-t.rot)})"><title>${I(`${e}, ${R(t.w)} x ${R(t.d)}`)}</title><rect x="${L(-t.w / 2)}" y="${L(-t.d / 2)}" width="${L(t.w)}" height="${L(t.d)}" fill="#ffffff" stroke="#737d83" stroke-width="0.6"/>${t.w >= 14 && t.d >= 8 && e.length * n * .55 < t.w ? l([0, n * .35], e, n, "#4a5257") : ""}</g>`);
	}
	for (let e of u) {
		let t = e.kind === "glass" ? "#8fb3bb" : e.kind === "half" ? "#8a9297" : e.kind === "rail" ? "#ffffff" : e.exterior ? "#23282c" : "#4a5257", n = p.has(e.id) ? " stroke=\"#9a3b2e\" stroke-width=\"1.2\"" : e.kind === "rail" ? " stroke=\"#23282c\" stroke-width=\"0.6\"" : "";
		s.push(`<polygon points="${j(M(e))}" fill="${t}"${n}/>`);
	}
	if (t.base) for (let e of f.walls.removed.map((e) => e.id)) {
		let r = t.base.walls.find((t) => t.id === e);
		r && r.level === n && s.push(`<polygon points="${j(M(r))}" fill="none" stroke="#9a3b2e" stroke-width="1" stroke-dasharray="4 3"/>`);
	}
	let m = new Map(u.map((e) => [e.id, e]));
	for (let t of e.openings) {
		let e = m.get(t.wall);
		if (!e) continue;
		let n = ie(t, e);
		s.push(`<polygon points="${j(n.gap)}" fill="#ffffff"/>`);
		for (let [e, r] of n.lines) s.push(c(e, r, "#23282c", t.kind === "window" ? .6 : .8));
		for (let [e, t] of n.dashed ?? []) s.push(c(e, t, "#23282c", .6, "2 2"));
		n.arc && s.push(`<path d="${n.arc}" fill="none" stroke="#23282c" stroke-width="0.5" stroke-dasharray="3 2"/>`);
	}
	if (t.base) for (let e of f.walls.moved) {
		let n = m.get(e.id), i = t.base.walls.find((t) => t.id === e.id);
		if (!n || !i || !e.move || e.move < .5) continue;
		let a = [(i.a[0] + i.b[0]) / 2, (i.a[1] + i.b[1]) / 2], o = [(n.a[0] + n.b[0]) / 2, (n.a[1] + n.b[1]) / 2];
		s.push(c(a, o, "#9a3b2e", 1)), s.push(`<circle cx="${L(o[0])}" cy="${L(o[1])}" r="1.6" fill="#9a3b2e"/>`), s.push(l([o[0], o[1] - 3], `moved ${R(e.move)}`, r * .75, "#9a3b2e"));
	}
	for (let t of e.stairs.filter((e) => e.level === n || e.toLevel === n)) {
		s.push(`<polygon points="${j(t.polygon)}" fill="none" stroke="#4a5257" stroke-width="0.6" stroke-dasharray="6 3"/>`);
		let e = g(t.polygon), i = [(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2], a = Math.min(e.x1 - e.x0, e.y1 - e.y0) * .6 + Math.abs(t.up[0] * (e.x1 - e.x0) + t.up[1] * (e.y1 - e.y0)) * .3, o = [i[0] + t.up[0] * a * .5, i[1] + t.up[1] * a * .5];
		s.push(c([i[0] - t.up[0] * a * .5, i[1] - t.up[1] * a * .5], o, "#4a5257", .6)), s.push(l([i[0], i[1] + r * .3], t.level === n ? "UP" : "DN", r * .7, "#4a5257"));
	}
	for (let t of e.dimensions.filter((e) => e.level === n)) {
		if (!(t.source === "sheet" && t.status === "ok" || t.source === "user" || t.source === "field" || t.status === "conflict")) continue;
		let n = t.status === "conflict" ? F.conflict : t.source === "sheet" ? "#a9b0b4" : F.measured, i = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2], a = Math.abs(t.b[1] - t.a[1]) > Math.abs(t.b[0] - t.a[0]);
		s.push(c(t.a, t.b, n, .4)), s.push(l(a ? [i[0] - 1.5, i[1]] : [i[0], i[1] - 1.5], ce(e, t).text, r * .62, n, { rotate: a }));
	}
	for (let t of d) for (let n of oe(e, t)) s.push(l(n.at, n.text, r * .7, F[n.badge], { rotate: n.vertical }));
	let h = se(e, n);
	if (h) {
		let e = h.y0 - 22, t = h.x0 - 22;
		s.push(c([h.x0, e], [h.x1, e], "#23282c", .5), c([h.x0, e - 4], [h.x0, e + 4], "#23282c", .5), c([h.x1, e - 4], [h.x1, e + 4], "#23282c", .5)), s.push(l([(h.x0 + h.x1) / 2, e - 3], R(h.x1 - h.x0), r * .8, "#23282c")), s.push(c([t, h.y0], [t, h.y1], "#23282c", .5), c([t - 4, h.y0], [t + 4, h.y0], "#23282c", .5), c([t - 4, h.y1], [t + 4, h.y1], "#23282c", .5)), s.push(l([t - 3, (h.y0 + h.y1) / 2], R(h.y1 - h.y0), r * .8, "#23282c", { rotate: !0 }));
	}
	for (let e of d) {
		let t = ae(e);
		s.push(l(t.at, t.name, r, "#23282c", { weight: "bold" })), s.push(l([t.at[0], t.at[1] + r * 1.15], t.area, r * .75, "#4a5257"));
	}
	if (e.project.north !== null && e.project.north !== void 0) {
		let t = [i.x1 - 30, i.y0 + 34];
		s.push(`<g transform="translate(${L(t[0])} ${L(t[1])}) rotate(${L(e.project.north)})"><circle r="14" fill="none" stroke="#23282c" stroke-width="0.6"/><path d="M 0 -12 L 5 6 L 0 2 L -5 6 Z" fill="#23282c"/></g>`, l([t[0], t[1] + 24], "N", r * .8, "#23282c", { weight: "bold" }));
	}
	return {
		svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${L(i.x0)} ${L(i.y0)} ${L(a)} ${L(o)}" width="${L(a)}" height="${L(o)}">${s.join("")}</svg>`,
		bounds: i,
		w: a,
		h: o
	};
}
var z = {
	edition: "Florida Building Code, Residential, 8th Edition (2023), which is based on the 2021 International Residential Code. Section numbers below are IRC 2021; the FBC adopts them with Florida amendments, and the numbers here were checked against 10-design-reference, not line by line against the FBC text.",
	nkba: "NKBA Kitchen and Bathroom Planning Guidelines (the checker's 'fix' level).",
	bath: {
		toiletCenterToSide: {
			code: 15,
			nkba: 18,
			source: "IRC R307.1, Figure R307.2; NKBA bath 15"
		},
		toiletFront: {
			code: 21,
			nkba: 30,
			source: "IRC R307.1; NKBA bath 14"
		},
		lavatoryFront: {
			code: 21,
			source: "IRC R307.1"
		},
		lavatoryWidthPerSink: {
			nkba: 30,
			double: 36,
			source: "NKBA bath 9"
		},
		showerMinSide: {
			code: 30,
			nkba: 36,
			source: "IRC P2708.1"
		},
		showerMinArea: {
			code: 900,
			source: "IRC P2708.1 (square inches)"
		},
		showerFront: {
			code: 24,
			nkba: 30,
			source: "IRC R307.1"
		},
		tubFront: {
			code: 21,
			source: "IRC R307.1"
		}
	},
	kitchen: {
		workAisle: {
			one: 42,
			two: 48,
			source: "NKBA kitchen 6"
		},
		walkway: {
			nkba: 36,
			source: "NKBA kitchen 7"
		},
		dishwasherStanding: {
			nkba: 21,
			source: "NKBA kitchen 19"
		},
		cooktopWindowEdge: {
			nkba: 3,
			source: "NKBA kitchen 23"
		}
	},
	doors: {
		egressClear: {
			code: 32,
			height: 78,
			source: "IRC R311.2"
		},
		interiorMin: { fix: 28 },
		recommended: { nkba: 32 }
	},
	egress: {
		netClearSf: {
			code: 5.7,
			grade: 5,
			source: "IRC R310.2.1"
		},
		minClearHeight: {
			code: 24,
			source: "IRC R310.2.1"
		},
		minClearWidth: {
			code: 20,
			source: "IRC R310.2.1"
		},
		maxSill: {
			code: 44,
			source: "IRC R310.2.2"
		}
	},
	stairs: {
		minWidth: {
			code: 36,
			source: "IRC R311.7.1"
		},
		maxRiser: {
			code: 7.75,
			source: "IRC R311.7.5.1"
		},
		minTread: {
			code: 10,
			source: "IRC R311.7.5.2"
		},
		headroom: {
			code: 80,
			source: "IRC R311.7.2"
		},
		landing: {
			code: 36,
			source: "IRC R311.7.6"
		}
	},
	halls: { minWidth: {
		code: 36,
		source: "IRC R311.6"
	} },
	glazing: {
		nearWetFloor: 60,
		nearDoor: 24,
		source: "IRC R308.4.2, R308.4.5"
	},
	plumbing: { toiletMoveNote: 24 }
}, fe = (e) => {
	let t = c(e) || 1;
	return [(e.b[0] - e.a[0]) / t, (e.b[1] - e.a[1]) / t];
};
function B(e, t, n) {
	return e.rooms.find((e) => e.level === t && e.polygon.length >= 3 && p(n, e.polygon));
}
function pe(e, t) {
	let n = e.walls.find((e) => e.id === t.wall);
	if (!n) return null;
	let r = fe(n);
	return {
		w: n,
		u: r,
		n: [r[1], -r[0]],
		c: [n.a[0] + r[0] * t.at, n.a[1] + r[1] * t.at]
	};
}
function V(e, t) {
	let n = pe(e, t);
	if (!n) return [void 0, void 0];
	let r = n.w.t / 2 + 12;
	return [B(e, n.w.level, [n.c[0] + n.n[0] * r, n.c[1] + n.n[1] * r]), B(e, n.w.level, [n.c[0] - n.n[0] * r, n.c[1] - n.n[1] * r])];
}
//#endregion
//#region src/analysis/checks.ts
function me(e) {
	let t = Math.max(0, e.h - (e.sill ?? 36)), n = Math.max(0, e.w - 3), r = Math.max(0, t - 3), [i, a] = e.style === "fixed" ? [0, 0] : e.style === "slider" ? [n / 2, r] : e.style === "casement" ? [n, r] : [n, r / 2];
	return {
		w: i,
		h: a,
		sf: i * a / 144
	};
}
//#endregion
//#region src/export/schedules.ts
var H = (e) => Math.round(e * 100) / 100, U = {
	measured: "measured",
	traced: "traced",
	assumed: "assumed",
	velda: "Velda"
}, he = (e) => [...e.levels].sort((e, t) => e.elev - t.elev)[0]?.id;
function ge(e) {
	let t = (t) => e.levels.find((e) => e.id === t)?.name ?? t, n = {
		name: "rooms",
		title: "Rooms",
		cols: [
			{
				key: "level",
				label: "Level"
			},
			{
				key: "name",
				label: "Room"
			},
			{
				key: "width_in",
				label: "Width",
				ft: !0
			},
			{
				key: "depth_in",
				label: "Depth",
				ft: !0
			},
			{
				key: "area_sf",
				label: "Area (sf)"
			},
			{
				key: "ceiling_in",
				label: "Ceiling",
				ft: !0
			},
			{
				key: "ceiling_source",
				label: "Ceiling from"
			},
			{
				key: "flags",
				label: "Flags"
			},
			{
				key: "theme",
				label: "Theme"
			}
		],
		rows: e.rooms.filter((e) => e.polygon.length >= 3).map((n) => {
			let r = g(n.polygon), i = e.levels.find((e) => e.id === n.level);
			return {
				level: t(n.level),
				name: n.name,
				width_in: H(r.x1 - r.x0),
				depth_in: H(r.y1 - r.y0),
				area_sf: Math.round(h(n.polygon) / 144),
				ceiling_in: H(n.ceiling ?? i?.ceiling ?? 0),
				ceiling_source: n.ceiling ? "room" : i ? U[w(i.prov.ceiling)] : "",
				flags: n.flags.map((e) => e.replace(/_/g, " ")).join("; "),
				theme: n.theme ? e.themes[n.theme]?.name ?? "" : ""
			};
		})
	}, r = (t) => e.walls.find((e) => e.id === t), i = (t) => {
		let [n, r] = V(e, t);
		return [n?.name, r?.name].filter(Boolean).join(" / ") || "outside";
	}, a = {
		name: "doors",
		title: "Doors and openings",
		cols: [
			{
				key: "id",
				label: "Id"
			},
			{
				key: "level",
				label: "Level"
			},
			{
				key: "rooms",
				label: "Between"
			},
			{
				key: "width_in",
				label: "Width",
				ft: !0
			},
			{
				key: "height_in",
				label: "Height",
				ft: !0
			},
			{
				key: "style",
				label: "Style"
			},
			{
				key: "swing",
				label: "Swing"
			},
			{
				key: "source",
				label: "Sizes from"
			}
		],
		rows: e.openings.filter((e) => e.kind !== "window").map((n) => {
			let a = r(n.wall), [o, s] = V(e, n), c = n.swing ? n.swing.side === "left" ? o : s : null;
			return {
				id: n.id,
				level: a ? t(a.level) : "",
				rooms: i(n),
				width_in: H(n.w),
				height_in: H(n.h),
				style: n.kind === "opening" ? "cased opening" : n.kind === "garage" ? "garage" : n.style.replace(/_/g, " "),
				swing: n.swing ? `into ${c?.name ?? "outside"}, hinge at the ${n.swing.hinge === "a" ? "start" : "end"} of the wall` : "",
				source: `${U[w(n.prov.w)]} width, ${U[w(n.prov.h)]} height`
			};
		})
	}, o = he(e);
	return [
		n,
		a,
		{
			name: "windows",
			title: "Windows",
			cols: [
				{
					key: "id",
					label: "Id"
				},
				{
					key: "level",
					label: "Level"
				},
				{
					key: "room",
					label: "Room"
				},
				{
					key: "width_in",
					label: "Width",
					ft: !0
				},
				{
					key: "head_in",
					label: "Head",
					ft: !0
				},
				{
					key: "sill_in",
					label: "Sill",
					ft: !0
				},
				{
					key: "style",
					label: "Style"
				},
				{
					key: "egress",
					label: "Egress"
				},
				{
					key: "source",
					label: "Sizes from"
				}
			],
			rows: e.openings.filter((e) => e.kind === "window").map((e) => {
				let n = r(e.wall), a = me(e), s = n?.level === o ? z.egress.netClearSf.grade : z.egress.netClearSf.code, c = a.sf >= s && a.h >= z.egress.minClearHeight.code && a.w >= z.egress.minClearWidth.code && (e.sill ?? 36) <= z.egress.maxSill.code, l = w(e.prov.h) === "assumed" || w(e.prov.sill) === "assumed";
				return {
					id: e.id,
					level: n ? t(n.level) : "",
					room: i(e).replace(/ \/ outside$|^outside \/ /, ""),
					width_in: H(e.w),
					head_in: H(e.h),
					sill_in: H(e.sill ?? 36),
					style: e.style.replace(/_/g, " "),
					egress: c ? l ? "yes, on assumed heights" : "yes" : l ? "no, on assumed heights" : "no",
					source: `${U[w(e.prov.w)]} width, ${U[w(e.prov.h)]} head, ${U[w(e.prov.sill)]} sill`
				};
			})
		},
		{
			name: "items",
			title: "Fixtures and products",
			cols: [
				{
					key: "level",
					label: "Level"
				},
				{
					key: "room",
					label: "Room"
				},
				{
					key: "item",
					label: "Item"
				},
				{
					key: "kind",
					label: "Kind"
				},
				{
					key: "width_in",
					label: "Width",
					ft: !0
				},
				{
					key: "depth_in",
					label: "Depth",
					ft: !0
				},
				{
					key: "height_in",
					label: "Height",
					ft: !0
				},
				{
					key: "vendor",
					label: "Vendor"
				},
				{
					key: "price",
					label: "Price"
				},
				{
					key: "link",
					label: "Link"
				}
			],
			rows: e.items.map((n) => {
				let r = e.rooms.find((e) => e.level === n.level && e.polygon.length >= 3 && p([n.x, n.y], e.polygon)), i = n.product?.url ?? (typeof n.props?.url == "string" ? n.props.url : ""), a = n.product?.price ?? (typeof n.props?.price == "string" ? n.props.price : ""), o = n.product?.vendor ?? "";
				if (!o && i) try {
					o = new URL(i).hostname.replace(/^www\./, "");
				} catch {}
				return {
					level: t(n.level),
					room: r?.name ?? "",
					item: n.label || n.kind.replace(/_/g, " "),
					kind: n.kind.replace(/_/g, " "),
					width_in: H(n.w),
					depth_in: H(n.d),
					height_in: H(n.h),
					vendor: o,
					price: a === "" ? "" : String(a),
					link: i
				};
			})
		}
	];
}
function _e(e, t, n) {
	let r = n[t.key];
	return t.ft && typeof r == "number" ? r ? C(r) : "" : r == null ? "" : String(r);
}
//#endregion
//#region src/lib/theme.ts
var ve = [
	"walls",
	"trim",
	"cabinets",
	"island",
	"counters",
	"floors",
	"accent",
	"metal"
], ye = {
	walls: { color: "#f2eee6" },
	trim: { color: "#ece6da" },
	cabinets: { color: "#e8e2d6" },
	island: { color: "#e8e2d6" },
	counters: { color: "#efece6" },
	floors: { library: "wood-woodfine22" },
	accent: { color: "#b38b6d" },
	metal: { color: "#8c8c8c" }
}, be = {
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
function W(e, t) {
	return e?.data?.palette?.find((e) => (e.role || "").toLowerCase() === t);
}
function xe(e, t) {
	let n = e?.data?.finishes?.[t];
	if (n?.library && be[n.library] || n?.color) return n;
	let r = W(e, t);
	if (r?.hex) return { color: r.hex };
	if (t === "island") return xe(e, "cabinets");
	if (t === "trim") {
		let t = W(e, "walls");
		if (t?.hex) return { color: t.hex };
	}
	return ye[t];
}
//#endregion
//#region src/viewer/scene3d.ts
var G = .0254;
function Se(e, t, n, r) {
	let i = r && e.themes[r] || (e.theme ? e.themes[e.theme] : void 0), a = (i?.data)?.finishes?.[t];
	return a?.color ? a.color : i?.data.palette?.find((e) => (e.role ?? "").toLowerCase() === t)?.hex ?? n;
}
function Ce(e, t, n) {
	let r = new e.Group(), i = [...t.levels].sort((e, t) => e.elev - t.elev), a = n.level ? i.filter((e) => e.id === n.level) : i, o = new e.MeshStandardMaterial({
		color: Se(t, "walls", "#efebe4"),
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
		let a = i.elev * G, h = new e.Group();
		h.name = i.id, r.add(h), f = h;
		for (let n of t.rooms.filter((e) => e.level === i.id && e.polygon.length >= 3)) {
			let r = new e.Shape(n.polygon.map(([t, n]) => new e.Vector2(t * G, -n * G))), i = new e.ShapeGeometry(r);
			i.rotateX(-Math.PI / 2);
			let o = new e.Mesh(i, new e.MeshStandardMaterial({
				color: Se(t, "floors", "#d8ccb6", n.theme),
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
					i * G,
					a + (t + n) / 2 * G,
					o * G
				];
			}, C = (e, t, n, i) => {
				let a = Math.min(i, _);
				if (a <= n || t - e < .1) return;
				let [o, s, c] = S((e + t) / 2, n, a);
				p((t - e) * G, (a - n) * G, v * G, x, o, s, c, b, r.id);
			}, w = new e.Group();
			w.name = r.id, h.add(w), f = w;
			let T = t.openings.filter((e) => e.wall === r.id).sort((e, t) => e.at - t.at), E = 0;
			for (let e of T) {
				let t = Math.max(0, e.at - e.w / 2), r = Math.min(d, e.at + e.w / 2);
				C(E, t, 0, g);
				let i = e.kind === "window" ? e.sill ?? 36 : 0;
				if (C(t, r, 0, i), C(t, r, Math.min(e.h, g), g), e.kind === "window" && !n.cut) {
					let [n, a, o] = S((t + r) / 2, i, Math.min(e.h, g));
					p((r - t) * G, (Math.min(e.h, g) - i) * G, .4 * G, c, n, a, o, b, e.id);
				}
				E = Math.max(E, r);
			}
			C(E, d, 0, g), f = h, m.expandByPoint(new e.Vector3(r.a[0] * G, a, r.a[1] * G)), m.expandByPoint(new e.Vector3(r.b[0] * G, a + g * G, r.b[1] * G));
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
			p(e.w * G, (n.cut ? Math.min(t, Math.max(1, 42 - r)) : t) * G, e.d * G, i, e.x * G, a + (r + (n.cut ? Math.min(t, Math.max(1, 42 - r)) : t) / 2) * G, e.y * G, e.rot * Math.PI / 180, e.id);
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
var we = "/* The share viewer: the studio's look, read-only. */\n#velda-viewer { display: flex; flex-direction: column; height: 100%; }\n.vw-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 12px 18px; border-bottom: 1px solid #e3e1db; background: #fbfbf8; }\n.vw-title { display: flex; flex-direction: column; margin-right: auto; }\n.vw-title strong { font: 400 22px/1.1 Georgia, \"Times New Roman\", serif; }\n.muted { color: #737d83; }\n.vw-head button, .vw-tabs button { border: 1px solid #d9d6cf; background: #fff; border-radius: 999px; padding: 4px 12px; font: inherit; color: #4a5257; cursor: pointer; }\n.vw-head button[aria-pressed='true'], .vw-tabs button[aria-selected='true'] { background: #e4efec; border-color: #2e6b62; color: #2e6b62; }\n.vw-levels, .vw-views { display: flex; gap: 6px; }\n.vw-scheme select { font: inherit; padding: 3px 6px; }\n.vw-body { flex: 1; display: grid; grid-template-columns: 1fr 340px; min-height: 0; }\n.vw-stage { position: relative; min-height: 0; display: flex; flex-direction: column; }\n.vw-plan { flex: 1; min-height: 0; cursor: grab; touch-action: none; }\n.vw-plan:active { cursor: grabbing; }\n.vw-3d { flex: 1; min-height: 0; }\n.vw-3d canvas { display: block; width: 100%; height: 100%; }\n.vw-intent { margin: 0; padding: 6px 14px; font-size: 12px; font-weight: 600; color: #9a3b2e; border-top: 1px solid #e3e1db; }\n.vw-legend { position: absolute; left: 12px; bottom: 40px; margin: 0; padding: 8px 10px; list-style: none; background: rgba(251,251,248,.92); border: 1px solid #e3e1db; border-radius: 8px; font-size: 12px; }\n.vw-legend li, .vw-sw li { display: flex; align-items: center; gap: 6px; }\n.sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(0,0,0,.12); }\n.vw-pin circle { fill: #2e6b62; stroke: #fff; stroke-width: 2; cursor: pointer; }\n.vw-pin text { fill: #fff; pointer-events: none; }\n.vw-pin.is-on circle { fill: #9a3b2e; }\n.vw-pin.is-resolved circle { fill: #8a9297; }\n.vw-side { border-left: 1px solid #e3e1db; display: flex; flex-direction: column; min-height: 0; background: #fbfbf8; }\n.vw-tabs { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #e3e1db; }\n.vw-panel { overflow: auto; padding: 12px 14px; }\n.vw-comment { border: 1px solid #e3e1db; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; background: #fff; cursor: pointer; }\n.vw-comment.is-on { border-color: #9a3b2e; }\n.vw-comment p, .vw-reply p { margin: 4px 0 0; }\n.vw-reply { margin: 8px 0 0 12px; padding-left: 8px; border-left: 2px solid #e3e1db; }\n.vw-meta { font-size: 12px; color: #737d83; display: flex; gap: 6px; align-items: center; }\n.vw-num { background: #2e6b62; color: #fff; border-radius: 999px; min-width: 18px; text-align: center; font-size: 11px; }\n.vw-mood { border-bottom: 1px solid #e3e1db; padding-bottom: 12px; margin-bottom: 12px; }\n.vw-mood h3 { margin: 0; font: 400 20px Georgia, serif; }\n.vw-sw, .vw-mat { list-style: none; padding: 0; margin: 8px 0; font-size: 13px; display: grid; gap: 3px; }\n.vw-sw code { color: #737d83; font-size: 11px; }\n.vw-pics { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }\n.vw-pics li { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }\n.vw-pics img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; }\n.vw-chips { display: flex; height: 64px; border-radius: 6px; overflow: hidden; }\n.vw-chips span { flex: 1; }\n.vw-cap { color: #4a5257; }\n.vw-pics a { color: #2e6b62; }\n@media (max-width: 760px) { .vw-body { grid-template-columns: 1fr; grid-template-rows: 60vh auto; } .vw-side { border-left: 0; border-top: 1px solid #e3e1db; } }\n.vw-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 4px 0 14px; font-variant-numeric: tabular-nums; }\n.vw-table th { text-align: left; font-weight: 600; color: #4a5257; border-bottom: 1px solid #c9ced1; padding: 3px 6px 3px 0; }\n.vw-table td { border-bottom: 1px solid #eceeef; padding: 3px 6px 3px 0; vertical-align: top; }\n.vw-table .num { white-space: nowrap; }\n", K = JSON.parse(document.getElementById("velda-data").textContent || "{}"), Te = document.getElementById("velda-viewer"), Ee = document.createElement("style");
Ee.textContent = we, document.head.appendChild(Ee);
var q = (e, t = {}, ...n) => {
	let r = document.createElement(e);
	for (let [e, n] of Object.entries(t)) n != null && n !== !1 && (e.startsWith("on") && typeof n == "function" ? r.addEventListener(e.slice(2).toLowerCase(), n) : e === "class" ? r.className = n : r.setAttribute(e, n === !0 ? "" : String(n)));
	for (let e of n) e != null && e !== !1 && r.append(e);
	return r;
}, De = (e) => C(e), J = (e) => [...e.levels].sort((e, t) => e.elev - t.elev).find((t) => e.walls.some((e) => e.level === t.id))?.id ?? e.levels[0]?.id ?? null, Y = {
	scheme: Math.max(0, K.schemes.findIndex((e) => !e.asBuilt)),
	level: null,
	view: "plan",
	cut: !0,
	tab: "comments",
	pin: null
};
Y.level = J(K.schemes[Y.scheme].model);
var X = () => K.schemes[Y.scheme], Z = {
	meshes: 0,
	view: "plan",
	level: Y.level
};
window.__viewer = Z;
function Q() {
	Te.replaceChildren(Oe(), q("div", { class: "vw-body" }, ke(), Ne())), Z.view = Y.view, Z.level = Y.level;
}
function Oe() {
	let e = X(), t = [...e.model.levels].sort((e, t) => e.elev - t.elev).filter((t) => e.model.walls.some((e) => e.level === t.id));
	return q("header", { class: "vw-head" }, q("div", { class: "vw-title" }, q("strong", {}, K.project.name), K.project.address ? q("span", { class: "muted" }, K.project.address) : null), K.schemes.length > 1 ? q("label", { class: "vw-scheme" }, "Scheme ", (() => {
		let e = q("select", {
			"aria-label": "Scheme",
			onchange: (e) => (Y.scheme = Number(e.target.value), Y.level = J(X().model) ?? Y.level, Y.pin = null, Q())
		});
		return K.schemes.forEach((t, n) => e.append(q("option", {
			value: n,
			selected: n === Y.scheme
		}, `${t.name}${t.asBuilt ? " (as-built)" : ""}`))), e;
	})()) : q("span", { class: "vw-scheme" }, e.name), q("nav", {
		class: "vw-levels",
		"aria-label": "Level"
	}, ...Y.view === "3d" && t.length > 1 ? [q("button", {
		"aria-pressed": Y.level === null,
		onclick: () => (Y.level = null, Q())
	}, "Whole house")] : [], ...t.map((e) => q("button", {
		"aria-pressed": Y.level === e.id,
		onclick: () => (Y.level = e.id, Q())
	}, e.name))), q("div", {
		class: "vw-views",
		role: "group",
		"aria-label": "View"
	}, q("button", {
		"aria-pressed": Y.view === "plan",
		onclick: () => (Y.view = "plan", Y.level = Y.level ?? J(X().model), Q())
	}, "Plan"), q("button", {
		"aria-pressed": Y.view === "3d",
		onclick: () => (Y.view = "3d", Q())
	}, "3D"), Y.view === "3d" ? q("button", {
		"aria-pressed": Y.cut,
		onclick: () => (Y.cut = !Y.cut, Q())
	}, Y.cut ? "Walls cut away" : "Walls full height") : null));
}
function ke() {
	let e = q("main", { class: "vw-stage" });
	return Y.view === "plan" ? Ae(e) : Me(e), e.append(q("p", { class: "vw-intent" }, K.intent)), e;
}
function Ae(e) {
	let t = X(), n = Y.level ?? J(t.model);
	if (!n) return;
	let r = de(t.model, {
		level: n,
		text: 9
	}), i = q("div", { class: "vw-plan" });
	i.innerHTML = r.svg;
	let a = i.querySelector("svg");
	a.setAttribute("width", "100%"), a.setAttribute("height", "100%"), a.setAttribute("role", "img"), a.setAttribute("aria-label", `${t.model.levels.find((e) => e.id === n)?.name ?? ""} plan`), t.comments.filter((e) => e.level === n).forEach((e, t) => {
		let n = document.createElementNS("http://www.w3.org/2000/svg", "g");
		n.setAttribute("class", `vw-pin${Y.pin === e.id ? " is-on" : ""}${e.resolved ? " is-resolved" : ""}`), n.setAttribute("data-id", e.id), n.setAttribute("transform", `translate(${e.at[0]} ${e.at[1]})`), n.innerHTML = `<circle r="9"></circle><text y="3.5" text-anchor="middle" font-size="10" font-family="helvetica">${t + 1}</text>`, n.addEventListener("click", (t) => {
			t.stopPropagation(), Y.pin = e.id, Y.tab = "comments", Q();
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
	}), i.addEventListener("pointerup", () => c = null), e.append(i, je());
}
function je() {
	return q("ul", {
		class: "vw-legend",
		"aria-label": "Where the numbers came from"
	}, ...[
		"measured",
		"traced",
		"assumed",
		"velda",
		"conflict"
	].map((e) => q("li", {}, q("span", {
		class: "sw",
		style: `background:${F[e]}`
	}), le[e])));
}
var $ = null;
async function Me(e) {
	let t = q("div", { class: "vw-3d" }, q("p", { class: "muted" }, "Loading the 3D view..."));
	e.append(t);
	try {
		let e = await import("three"), { OrbitControls: n } = await import("three/addons/controls/OrbitControls.js"), r = Ce(e, X().model, {
			level: Y.level,
			cut: Y.cut
		});
		Z.meshes = r.meshes;
		let i = new e.Scene();
		i.background = new e.Color("#f3f1ec"), i.add(new e.HemisphereLight("#ffffff", "#bdb7aa", 1.6));
		let a = new e.DirectionalLight("#ffffff", 1.4);
		a.position.set(r.center.x + r.size, r.size * 1.2, r.center.z + r.size * .6), i.add(a), i.add(r.group);
		let o = t.clientWidth || 800, s = t.clientHeight || 600, c = new e.PerspectiveCamera(45, o / s, .05, 500), l = r.size * 1.15;
		c.position.set(r.center.x + l * .35, r.center.y + l * .8, r.center.z + l * .9), $?.dispose?.(), $ = new e.WebGLRenderer({
			antialias: !0,
			preserveDrawingBuffer: !0
		}), $.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)), $.setSize(o, s), t.replaceChildren($.domElement);
		let u = new n(c, $.domElement);
		u.target.copy(r.center), u.update();
		let d = () => {
			$.domElement.isConnected && ($.render(i, c), requestAnimationFrame(d));
		};
		d(), new ResizeObserver(() => {
			let e = t.clientWidth, n = t.clientHeight;
			e && n && (c.aspect = e / n, c.updateProjectionMatrix(), $.setSize(e, n));
		}).observe(t);
	} catch (e) {
		t.replaceChildren(q("p", { class: "muted" }, `The 3D view needs a connection to cdn.jsdelivr.net (${String(e).slice(0, 80)}).`));
	}
}
function Ne() {
	let e = X(), t = q("div", {
		class: "vw-tabs",
		role: "tablist"
	}, ...[
		["comments", `Comments (${e.comments.length})`],
		["sizes", "Sizes"],
		["mood", "Mood boards"],
		["info", "About"]
	].map(([e, t]) => q("button", {
		role: "tab",
		"aria-selected": Y.tab === e,
		onclick: () => (Y.tab = e, Q())
	}, t))), n = q("div", { class: "vw-panel" });
	return Y.tab === "comments" ? n.append(...Pe(e)) : Y.tab === "sizes" ? n.append(...Ie(e.model)) : Y.tab === "mood" ? n.append(...Le(e.model)) : n.append(...Be(e)), q("aside", { class: "vw-side" }, t, n);
}
function Pe(e) {
	if (!e.comments.length) return [q("p", { class: "muted" }, "No comments on this scheme.")];
	let t = (t) => e.model.levels.find((e) => e.id === t)?.name ?? t, n = /* @__PURE__ */ new Map();
	return e.comments.map((e) => {
		let r = (n.get(e.level) ?? 0) + 1;
		return n.set(e.level, r), q("article", {
			class: `vw-comment${Y.pin === e.id ? " is-on" : ""}${e.resolved ? " is-resolved" : ""}`,
			"data-id": e.id,
			onclick: () => (Y.pin = e.id, Y.level = e.level, Y.view = "plan", Q())
		}, q("div", { class: "vw-meta" }, q("span", { class: "vw-num" }, String(r)), `${t(e.level)} · ${e.author} · ${e.created_at.slice(0, 10)}${e.resolved ? " · resolved" : ""}`), q("p", {}, e.body), ...e.replies.map((e) => q("div", { class: "vw-reply" }, q("div", { class: "vw-meta" }, `${e.author} · ${e.created_at.slice(0, 10)}`), q("p", {}, e.body))));
	});
}
var Fe = {
	rooms: [
		"name",
		"width_in",
		"depth_in",
		"area_sf",
		"ceiling_in"
	],
	doors: [
		"rooms",
		"width_in",
		"height_in",
		"style",
		"swing"
	],
	windows: [
		"room",
		"width_in",
		"head_in",
		"sill_in",
		"style",
		"egress"
	],
	items: [
		"room",
		"item",
		"width_in",
		"depth_in",
		"height_in",
		"vendor"
	]
};
function Ie(e) {
	let t = e.levels.find((e) => e.id === Y.level)?.name, n = [q("p", { class: "muted" }, `${t ?? "Every level"}. Rooms are wall to wall; heights are from the floor.`)];
	for (let r of ge(e)) {
		let e = r.rows.filter((e) => !t || e.level === t);
		if (!e.length) continue;
		let i = r.cols.filter((e) => Fe[r.name]?.includes(e.key)), a = (e, t, n) => {
			let r = _e(e, t, n);
			return t.key === "vendor" && n.link ? q("a", {
				href: String(n.link),
				target: "_blank",
				rel: "noreferrer noopener"
			}, r || "link") : r;
		};
		n.push(q("h3", {}, r.title), q("table", { class: "vw-table" }, q("thead", {}, q("tr", {}, ...i.map((e) => q("th", {}, e.label)))), q("tbody", {}, ...e.map((e) => q("tr", {}, ...i.map((t) => q("td", { class: t.ft || t.key === "area_sf" ? "num" : void 0 }, a(r, t, e))))))));
	}
	return n;
}
function Le(e) {
	let t = e.rooms.filter((t) => t.polygon.length >= 3 && (t.theme || e.inspiration.some((e) => e.rooms.includes(t.id))));
	return t.length ? t.map((t) => Re(e, t)) : [q("p", { class: "muted" }, "No mood boards yet: no room has a theme or inspiration in this scheme.")];
}
function Re(e, t) {
	let n = t.theme && e.themes[t.theme] || (e.theme ? e.themes[e.theme] : null), r = g(t.polygon), i = e.inspiration.filter((e) => e.rooms.includes(t.id) && e.kind !== "board").slice(0, 12), a = [];
	if (n) for (let e of ve) {
		let t = W(n, e), r = xe(n, e);
		if (!t && !n.data.finishes?.[e]) continue;
		let i = r.color ?? t?.hex ?? "#ddd";
		a.push(q("li", {}, q("span", {
			class: "sw",
			style: `background:${i}`
		}), q("strong", {}, e), ` ${t?.name ?? ""} `, q("code", {}, i)));
	}
	return q("section", { class: "vw-mood" }, q("h3", {}, t.name), q("p", { class: "muted" }, `${De(r.x1 - r.x0)} x ${De(r.y1 - r.y0)}, ${Math.round(h(t.polygon) / 144)} sf`), n ? q("p", {}, q("strong", {}, n.name), n.data.description ? ` ${n.data.description}` : "") : null, a.length ? q("ul", { class: "vw-sw" }, ...a) : null, n?.data.materials?.length ? q("ul", { class: "vw-mat" }, ...n.data.materials.map((e) => q("li", {}, q("strong", {}, e.category), ` ${e.choice}`))) : null, i.length ? q("ul", { class: "vw-pics" }, ...i.map(ze)) : null);
}
function ze(e) {
	let t = K.thumbs[e.id], n = e.url ?? (e.image && /^https?:/.test(e.image) ? e.image : void 0), r = (e.tags.palette.length ? e.tags.palette : e.sampled ?? []).slice(0, 5);
	return q("li", {}, t ? q("img", {
		src: t,
		alt: e.title ?? "inspiration",
		loading: "lazy"
	}) : q("div", { class: "vw-chips" }, ...r.map((e) => q("span", {
		style: `background:${e.hex}`,
		title: e.hex
	}))), q("span", { class: "vw-cap" }, e.title ?? e.kind), n ? q("a", {
		href: n,
		target: "_blank",
		rel: "noreferrer noopener"
	}, e.source ?? "link") : null);
}
function Be(e) {
	return [
		q("p", {}, q("strong", {}, e.name), e.asBuilt ? " (the house as it is today)" : ""),
		q("p", { class: "muted" }, `${e.version}, ${e.date}`),
		q("p", {}, K.intent),
		q("p", { class: "muted" }, `Shared ${K.created.slice(0, 10)} from Velda Studio. This page is read-only.`)
	];
}
Q();
//#endregion
