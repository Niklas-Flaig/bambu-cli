// Map a 15-char Bambu Lab serial number to a printer model from its prefix.
// Prefixes confirmed against the Bambu wiki (A1/A1 mini) and community decoders
// (forum "Serial number decoder"); X1C "00M" matches this printer's cert CN.
// The P1P/P1S pairing is reported both ways by different sources, so it is
// marked uncertain — the model can always be overridden in bambu.config.json.

const PREFIX_TO_MODEL: Record<string, string> = {
  "00M": "X1C", // X1 Carbon (this printer)
  "00W": "X1", // X1
  "03W": "X1E",
  "01S": "P1P", // P1P/P1S reported both ways across sources
  "01P": "P1S",
  "039": "A1",
  "030": "A1 mini",
  "094": "H2D",
  "239": "H2D Pro",
};

/** Best-effort model from the serial prefix; undefined if unknown. */
export function modelFromSerial(serial: string): string | undefined {
  const prefix = serial.trim().slice(0, 3).toUpperCase();
  return PREFIX_TO_MODEL[prefix];
}
