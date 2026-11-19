// PokéAPI flavor text is laid out for the old game screens: line breaks (\n), page breaks (\f),
// and words split across lines with a soft hyphen (U+00AD), e.g. "out­\nperform".
export function cleanFlavorText(text: string): string {
  return text
    .replace(/­\s*/g, '') // rejoin the split word
    .replace(/\s+/g, ' ')
    .trim()
}
