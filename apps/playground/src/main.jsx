import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import '@stagecraft/react/styles/main.css';
import './host.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
