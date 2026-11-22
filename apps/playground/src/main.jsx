import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import SourceWorkspace from './components/views/SourceWorkspace.jsx';
import '@stagecraft/react/styles/main.css';
import './host.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('mode') === 'source' ? <SourceWorkspace /> : <App />}
  </React.StrictMode>
);
