import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import Home from './pages/Home.tsx'
import BlogIndex from './pages/BlogIndex.tsx'
import BlogPost from './pages/BlogPost.tsx'
import IpCalculator from './pages/IpCalculator.tsx'
import JwtDecoder from './pages/JwtDecoder.tsx'
import NanoIdGenerator from './pages/NanoIdGenerator.tsx'
import UlidGenerator from './pages/UlidGenerator.tsx'
import UuidGenerator from './pages/UuidGenerator.tsx'
import X509Decoder from './pages/X509Decoder.tsx'
import NotFound from './pages/NotFound.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Home />} />
          <Route path="ip" element={<IpCalculator />} />
          <Route path="jwt" element={<JwtDecoder />} />
          <Route path="x509" element={<X509Decoder />} />
          <Route path="uuid" element={<UuidGenerator />} />
          <Route path="nanoid" element={<NanoIdGenerator />} />
          <Route path="ulid" element={<UlidGenerator />} />
          <Route path="blog" element={<BlogIndex />} />
          <Route path="blog/:slug" element={<BlogPost />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
