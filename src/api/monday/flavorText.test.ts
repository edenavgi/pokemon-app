import { describe, expect, it } from 'vitest'
import { cleanFlavorText } from './flavorText'

describe('cleanFlavorText', () => {
  it('joins words that PokéAPI splits with a soft hyphen at a line break', () => {
    // Real text of #65 Alakazam
    expect(cleanFlavorText('Its brain can out­\nperform a super­\ncomputer.\fIts intelligence\nquotient is said\nto be 5,000.'))
      .toBe('Its brain can outperform a supercomputer. Its intelligence quotient is said to be 5,000.')
  })
  it('keeps a real hyphen and collapses line breaks and form feeds', () => {
    expect(cleanFlavorText('to\fblast out 10000-\nvolt lightning\n')).toBe('to blast out 10000- volt lightning')
  })
})
