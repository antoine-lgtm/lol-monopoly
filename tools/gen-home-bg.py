"""Génère le fond de l'écran d'accueil : chaîne de montagnes nocturne.

Usage : python3 tools/gen-home-bg.py frontend/assets/home-bg.svg

Crêtes par déplacement du point milieu (fractal), lissées en courbes de Bézier,
perspective atmosphérique (plans lointains plus clairs et bleutés), lumière
rasante venant du haut à gauche, brume et grain.
"""
import random
import sys

W, H = 1600, 1000
random.seed(7)


def ridge(y_left, y_right, roughness, depth, peaks):
    """Profil de crête : liste de (x, y) de 0 à W."""
    n = 2 ** depth
    ys = [0.0] * (n + 1)
    ys[0], ys[n] = y_left, y_right
    step, amp = n, roughness
    while step > 1:
        half = step // 2
        for i in range(half, n, step):
            ys[i] = (ys[i - half] + ys[i + half]) / 2 + random.uniform(-amp, amp)
        amp *= 0.52
        step = half
    # sommets marqués pour casser l'aspect « colline »
    for px, height, width in peaks:
        for i in range(n + 1):
            x = i / n * W
            d = abs(x - px) / width
            if d < 1:
                ys[i] -= height * (1 - d) ** 1.6
    return [(i / n * W, ys[i]) for i in range(n + 1)]


def smooth_path(points, bottom=H):
    """Chemin fermé : courbe lissée passant par les milieux des segments."""
    d = [f"M0 {bottom}", f"L{points[0][0]:.1f} {points[0][1]:.1f}"]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        d.append(f"Q{x0:.1f} {y0:.1f} {mx:.1f} {my:.1f}")
    lx, ly = points[-1]
    d.append(f"L{lx:.1f} {ly:.1f} L{W} {bottom}Z")
    return " ".join(d)


def open_path(points):
    d = [f"M{points[0][0]:.1f} {points[0][1]:.1f}"]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        d.append(f"Q{x0:.1f} {y0:.1f} {(x0 + x1) / 2:.1f} {(y0 + y1) / 2:.1f}")
    return " ".join(d)


# (y gauche, y droite, rugosité, profondeur, sommets, dégradé haut→bas, lumière d'arête)
layers = [
    (430, 380, 70, 8, [(330, 190, 260), (760, 120, 180), (1180, 230, 300), (1480, 90, 160)],
     ("#1f425a", "#12304a"), 0.22),
    (520, 470, 60, 8, [(140, 120, 220), (560, 170, 260), (980, 110, 200), (1360, 160, 240)],
     ("#173a50", "#0e2838"), 0.16),
    (610, 580, 55, 8, [(420, 110, 260), (820, 70, 180), (1240, 120, 280)],
     ("#112d40", "#0a1f2c"), 0.12),
    (720, 690, 45, 7, [(200, 90, 260), (700, 60, 240), (1450, 100, 260)],
     ("#0b2231", "#071722"), 0.08),
    (840, 810, 35, 7, [(520, 50, 300), (1100, 70, 320)],
     ("#07141e", "#030b12"), 0.04),
]

out = []
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">')
out.append("""  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0c2233"/>
      <stop offset=".45" stop-color="#12304a"/>
      <stop offset="1" stop-color="#0a1c2a"/>
    </linearGradient>
    <radialGradient id="glow" cx=".18" cy=".32" r=".55">
      <stop offset="0" stop-color="#8fb9d0" stop-opacity=".22"/>
      <stop offset=".45" stop-color="#5d8aa6" stop-opacity=".10"/>
      <stop offset="1" stop-color="#5d8aa6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="light" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#bfe0f0" stop-opacity=".16"/>
      <stop offset=".5" stop-color="#bfe0f0" stop-opacity=".04"/>
      <stop offset="1" stop-color="#bfe0f0" stop-opacity="0"/>
    </linearGradient>
    <filter id="mist" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".0028 .012" numOctaves="3" seed="3"/>
      <feColorMatrix values="0 0 0 0 .62  0 0 0 0 .76  0 0 0 0 .84  0 0 0 .55 -.12"/>
      <feGaussianBlur stdDeviation="6"/>
    </filter>
    <linearGradient id="fadeY" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".35" stop-color="#fff" stop-opacity="1"/>
      <stop offset=".7" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="soft" maskContentUnits="objectBoundingBox">
      <rect width="1" height="1" fill="url(#fadeY)"/>
    </mask>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="9" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .07 0"/>
    </filter>""")
for i, (_, _, _, _, _, (top, bottom), _) in enumerate(layers):
    out.append(f"""    <linearGradient id="l{i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{top}"/>
      <stop offset="1" stop-color="{bottom}"/>
    </linearGradient>""")
out.append("  </defs>")

out.append(f'  <rect width="{W}" height="{H}" fill="url(#sky)"/>')
out.append(f'  <rect width="{W}" height="{H}" fill="url(#glow)"/>')

# étoiles, plus denses en haut
stars = []
for _ in range(90):
    x, y = random.uniform(0, W), random.uniform(0, 420) ** 1.0
    y = y * random.uniform(0.3, 1)
    r = random.choice([0.6, 0.7, 0.8, 1.0, 1.3])
    o = random.uniform(0.15, 0.6)
    stars.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r}" fill-opacity="{o:.2f}"/>')
out.append('  <g fill="#dcebf3">' + "".join(stars) + "</g>")

for i, (yl, yr, rough, depth, peaks, _, light) in enumerate(layers):
    pts = ridge(yl, yr, rough, depth, peaks)
    path = smooth_path(pts)
    out.append(f'  <path d="{path}" fill="url(#l{i})"/>')
    # lumière rasante du côté gauche des pentes
    out.append(f'  <path d="{path}" fill="url(#light)" opacity="{light * 3:.2f}"/>')
    # liseré lumineux sur la crête
    out.append(f'  <path d="{open_path(pts)}" fill="none" stroke="#a9d0e4" stroke-opacity="{light:.2f}" stroke-width="1.6"/>')
    # nappe de brume entre deux plans
    if i < len(layers) - 1:
        top = min(yl, yr) - 40
        out.append(f'  <rect y="{top}" width="{W}" height="{max(yl, yr) - top + 140}" filter="url(#mist)" mask="url(#soft)" opacity="{0.38 - i * 0.06:.2f}"/>')

out.append(f'  <rect width="{W}" height="{H}" fill="#010a13" fill-opacity=".18"/>')
out.append(f'  <rect width="{W}" height="{H}" filter="url(#grain)"/>')
out.append("</svg>")

open(sys.argv[1], "w").write("\n".join(out) + "\n")
