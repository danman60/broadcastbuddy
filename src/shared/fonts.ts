// Fonts available in the overlay. Google Fonts are loaded via stylesheet in the overlay HTML.
// System fonts work natively. Each entry has: value (CSS font-family), label, and whether it needs Google Fonts.

export interface FontOption {
  value: string       // CSS font-family value
  label: string       // display name
  google: boolean     // needs Google Fonts import
}

export const FONTS: FontOption[] = [
  // System fonts (always available)
  { value: "'Segoe UI', sans-serif", label: 'Segoe UI', google: false },
  { value: "'Arial', sans-serif", label: 'Arial', google: false },
  { value: "'Helvetica Neue', Helvetica, sans-serif", label: 'Helvetica Neue', google: false },
  { value: "'Georgia', serif", label: 'Georgia', google: false },
  { value: "'Times New Roman', serif", label: 'Times New Roman', google: false },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS', google: false },
  { value: "'Verdana', sans-serif", label: 'Verdana', google: false },
  { value: "'Impact', sans-serif", label: 'Impact', google: false },

  // Google Fonts — loaded in overlay HTML
  { value: "'Inter', sans-serif", label: 'Inter', google: true },
  { value: "'Roboto', sans-serif", label: 'Roboto', google: true },
  { value: "'Montserrat', sans-serif", label: 'Montserrat', google: true },
  { value: "'Open Sans', sans-serif", label: 'Open Sans', google: true },
  { value: "'Lato', sans-serif", label: 'Lato', google: true },
  { value: "'Poppins', sans-serif", label: 'Poppins', google: true },
  { value: "'Raleway', sans-serif", label: 'Raleway', google: true },
  { value: "'Oswald', sans-serif", label: 'Oswald', google: true },
  { value: "'Bebas Neue', sans-serif", label: 'Bebas Neue', google: true },
  { value: "'Playfair Display', serif", label: 'Playfair Display', google: true },
  { value: "'Merriweather', serif", label: 'Merriweather', google: true },
  { value: "'Lora', serif", label: 'Lora', google: true },
  { value: "'Source Sans 3', sans-serif", label: 'Source Sans 3', google: true },
  { value: "'Nunito', sans-serif", label: 'Nunito', google: true },
  { value: "'Barlow', sans-serif", label: 'Barlow', google: true },
  { value: "'Cabin', sans-serif", label: 'Cabin', google: true },
  { value: "'Rubik', sans-serif", label: 'Rubik', google: true },
  { value: "'Quicksand', sans-serif", label: 'Quicksand', google: true },
  { value: "'Dancing Script', cursive", label: 'Dancing Script', google: true },
  { value: "'Pacifico', cursive", label: 'Pacifico', google: true },
]

// Build the Google Fonts URL for the overlay HTML
export function buildGoogleFontsUrl(): string {
  const families = FONTS
    .filter(f => f.google)
    .map(f => {
      const name = f.label.replace(/ /g, '+')
      return `family=${name}:wght@400;600;700;800`
    })
    .join('&')

  return `https://fonts.googleapis.com/css2?${families}&display=swap`
}
