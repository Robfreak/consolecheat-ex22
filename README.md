# Pixel-Rätsel (Nonogramm) · consolecheat-ex22

Nonogramme mit Retro-Gaming-Motiven: Die Zahlen an Zeilen und Spalten verraten, wie viele Felder am Stück gefüllt sind, bis das Pixelbild erscheint. Eigene Rätsel entstehen aus einem PNG, dem Pixel-Avatar-Studio oder dem Sprite-Animator. Jedes Rätsel ist **eindeutig lösbar**. Teil der consolecheat-Werkzeuge. Inoffiziell, nicht von Sony.

**Live:** https://robfreak.github.io/consolecheat-ex22/ (nachdem GitHub Pages eingeschaltet ist, siehe unten)

## Rätselquellen

1. **Motive:** 11 eingebaute Rätsel in 5×5 (Herz, Pilz, Geist, Stern), 10×10 (Invasor, Mampfer, Controller, Heiltrank) und 15×15 (Ritter, Rakete, Schatztruhe). Alle sind per Test als eindeutig lösbar geprüft.
2. **Eigenes Bild:** ein PNG (bis 5 MB), der Avatar aus dem Pixel-Avatar-Studio oder das aktuelle Bild aus dem Sprite-Animator. Größe über die Vorgaben **10×10, 15×15 (Standard) und 20×20** oder frei 5–20 je Seite. Große Bilder wie der 64×64-Avatar werden nach Fläche verkleinert (jede Zelle mittelt die Deckkraft bzw. Dunkelheit der Pixel, die sie überdeckt), optional nach Zuschnitt auf den nicht leeren Bereich. Eine Zelle ist gefüllt, wenn der Mittelwert die **Schwelle** erreicht; gezählt werden deckende Pixel (Alpha) oder dunkle Pixel (Luminanz), umkehrbar.
3. **Link:** „Link teilen“ erzeugt `#w=15&h=15&b=<Raster als base64url>&t=<Titel>`. Der Teil hinter `#` geht nicht an den Server. Auch geöffnete Links werden geprüft.

### Nur eindeutige Rätsel

Ein Zeilenlöser (exakte Linien-Deduktion per dynamischer Programmierung, inkl. Überlappung) läuft abwechselnd über Zeilen und Spalten; danach zählt eine begrenzte Rückverfolgung die Lösungen bis 2 (Budget 20 000 Knoten). Leere und volle Bilder werden abgewiesen. Hat ein importiertes Bild mehr als eine Lösung, zeigt die Seite „Nicht eindeutig lösbar“ mit dem Rat, Schwelle oder Größe zu ändern, und bietet **„Automatisch reparieren“** an: Es kippt gezielt Pixel, in denen sich zwei Lösungen unterscheiden, bis das Rätsel eindeutig ist (höchstens 12, in der Vorschau markiert). Erst dann lässt sich das Rätsel starten. Ein Link mit nicht eindeutigem Rätsel wird nicht geöffnet.

### Avatar und Sprite: nur lesen

Alle consolecheat-Werkzeuge liegen auf `robfreak.github.io` und teilen sich den `localStorage`. Das Pixel-Rätsel liest beim Druck auf den Import-Knopf (nur `getItem`) und schreibt, ändert oder löscht diese Schlüssel **nie**:

- `consolecheat-avatar-v1` (Pixel-Avatar-Studio): `{ "version": 1, "pixels": "<Lauflängen für 64×64>" }`
- `consolecheat-sprite-v1` (Sprite-Animator, `Robfreak/consolecheat-ex14`): `{ "version": 1, "size": 16|32|64, "frames": ["<Lauflängen>", …], "index": n, … }`; verwendet wird das aktuelle Bild `index`.

Lauflängen: durch Kommas getrennt `ANZAHL:0` (transparent) oder `ANZAHL:RRGGBBAA`, zusammen genau Größe × Größe Pixel.

## Spielen

- Klick oder Tippen füllt ein Feld, Rechtsklick oder langes Drücken (450 ms) setzt ein X. Ziehen wiederholt die erste Änderung über mehrere Felder und ist ein Rückgängig-Schritt.
- Der Schalter „Füllen / X setzen“ legt fest, was ein Tippen tut (für Touch).
- Erfüllte Zeilen und Spalten werden an ihren Zahlen markiert. Gelöst ist das Rätsel, wenn die gefüllten Felder stimmen; X zählen nicht. Die Meldung mit Zeit und Hinweisen kommt per `aria-live`.
- Die Zeit läuft ab dem ersten Zug und pausiert, solange der Tab verborgen ist.
- **Hinweis:** korrigiert zuerst ein falsches Feld, sonst deckt er ein Feld auf, das der Zeilenlöser aus deinen richtigen Feldern ableiten kann, und nur notfalls ein zufälliges richtiges Feld. Hinweise werden gezählt.
- DE/EN (Standard Deutsch), hell/dunkel, ab 390 px Breite (15×15 und 20×20 passen), `role="grid"` mit beschrifteten Zellen und wanderndem `tabindex`.

## Steuerung

| Tastatur | Controller | Aktion |
| --- | --- | --- |
| Pfeiltasten, Pos1/Ende | Steuerkreuz | Cursor bewegen |
| Leertaste, Enter | × | Füllen |
| X | ○ | X setzen |
| Rücktaste, Entf | □ | Leeren |
| Strg+Z | L1 | Rückgängig |
| Strg+Y, Strg+Umschalt+Z | R1 | Wiederholen |
| H | △ | Hinweis |

Der erste Abruf eines Controllers (auch nach dem Wiederverbinden) merkt sich nur den Tastenzustand. In Textfeldern und Auswahllisten greifen keine Kürzel; auf dem Schwellen-Schieberegler nur Rückgängig und Wiederholen.

## Speicher

`consolecheat-nonogram-v1` (Schema `consolecheat-nonogram`, Version 1): aktuelles Rätsel (Größe, Raster, Quelle, Titel), Spielstand, Zeit, Zahl der Hinweise, gelöste Rätsel mit Bestzeit (höchstens 200) und das Tipp-Werkzeug. Der Rückgängig-Verlauf gilt nur für die offene Seite. Unlesbare Teile werden übersprungen. Der Knopf auf der Datenschutz-Seite löscht nur diesen Schlüssel; Avatar und Sprite werden nur gelesen.

## Entwicklung

Node 22.6 oder neuer.

```sh
npm ci
npm test        # node --test über src/nonogram/*.test.ts
npm run build   # tsc, vite build, scripts/check-dist.mjs
npm run dev
```

Der Code liegt in `src/nonogram`. Die Seite lädt nichts von Dritten; `scripts/check-dist.mjs` prüft das im Build.

## GitHub Pages einschalten

Der Workflow `.github/workflows/pages.yml` baut bei jedem Push auf `main` und legt `dist/` in den Branch `gh-pages`. Einmalig: **Settings → Pages → Source: Deploy from a branch → Branch `gh-pages` / `(root)`**. Danach ist die Seite unter https://robfreak.github.io/consolecheat-ex22/ erreichbar.

## Lizenz der Schriften

Outfit und Source Sans 3 stehen unter der SIL Open Font License, siehe `public/FONT-OFL.txt` und `THIRD_PARTY_NOTICES.md`.
