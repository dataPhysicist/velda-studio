import './rooms.css'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { boot } from './store'

declare const __STUDIO_VERSION__: string
console.info(`[rooms] v${typeof __STUDIO_VERSION__ === 'string' ? __STUDIO_VERSION__ : 'dev'}`)

createRoot(document.getElementById('root')!).render(<App />)
void boot()
