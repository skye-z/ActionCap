import React from 'react'
import ReactDOM from 'react-dom/client'
import 'rrweb-player/dist/style.css'
import { ResultsApp } from './results-app'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ResultsApp />
  </React.StrictMode>,
)
