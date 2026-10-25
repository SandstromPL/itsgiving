import {
  Bodoni_Moda,
  Bricolage_Grotesque,
  Cinzel,
  Courier_Prime,
  Fraunces,
  Instrument_Serif,
  JetBrains_Mono,
  Jost,
  Michroma,
  Tilt_Neon,
  Yatra_One,
} from "next/font/google";

// The house faces: Bricolage Grotesque is the tool, Instrument Serif is the treatment's own voice, and JetBrains Mono
// is Qloo evidence on receipt slips.
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], axes: ["opsz"] });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

// Title-card faces for the cover's font window. Not preloaded: a face downloads only when a title is set in it.
const yatra = Yatra_One({ variable: "--font-tc-yatra", subsets: ["latin"], weight: "400", preload: false });
const jost = Jost({ variable: "--font-tc-jost", subsets: ["latin"], weight: "600", preload: false });
const cinzel = Cinzel({ variable: "--font-tc-cinzel", subsets: ["latin"], weight: "600", preload: false });
const courier = Courier_Prime({ variable: "--font-tc-courier", subsets: ["latin"], weight: "700", preload: false });
const tilt = Tilt_Neon({ variable: "--font-tc-tilt", subsets: ["latin"], preload: false });
const fraunces = Fraunces({ variable: "--font-tc-fraunces", subsets: ["latin"], axes: ["SOFT", "WONK"], preload: false });
const bodoni = Bodoni_Moda({ variable: "--font-tc-bodoni", subsets: ["latin"], style: "italic", preload: false });
const michroma = Michroma({ variable: "--font-tc-michroma", subsets: ["latin"], weight: "400", preload: false });

export const fontVariables = [bricolage, instrument, jetbrains, yatra, jost, cinzel, courier, tilt, fraunces, bodoni, michroma]
  .map((font) => font.variable)
  .join(" ");
