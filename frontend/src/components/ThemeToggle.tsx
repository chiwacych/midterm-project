import { useEffect, useState } from 'react'
import styles from './ThemeToggle.module.css'

type Theme = 'light' | 'dark' | 'auto'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme') as Theme
    return saved || 'dark'
  })

  useEffect(() => {
    const applyTheme = (selectedTheme: Theme) => {
      let effectiveTheme: 'light' | 'dark' = 'dark'
      
      if (selectedTheme === 'auto') {
        effectiveTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
      } else {
        effectiveTheme = selectedTheme
      }

      if (effectiveTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light')
      } else {
        document.documentElement.removeAttribute('data-theme')
      }
    }

    applyTheme(theme)
    localStorage.setItem('theme', theme)

    // Listen for system theme changes if auto is selected
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
      const handleChange = () => applyTheme('auto')
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
  }

  return (
    <div className={styles.themeToggle}>
      <button
        type="button"
        className={`${styles.themeButton} ${theme === 'light' ? styles.active : ''}`}
        onClick={() => handleThemeChange('light')}
        title="Light mode"
      >
        ☀️
      </button>
      <button
        type="button"
        className={`${styles.themeButton} ${theme === 'dark' ? styles.active : ''}`}
        onClick={() => handleThemeChange('dark')}
        title="Dark mode"
      >
        🌙
      </button>
      <button
        type="button"
        className={`${styles.themeButton} ${theme === 'auto' ? styles.active : ''}`}
        onClick={() => handleThemeChange('auto')}
        title="Auto (system)"
      >
        🤖
      </button>
    </div>
  )
}
