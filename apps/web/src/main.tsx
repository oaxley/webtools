import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import Home from './pages/Home.tsx'
import BlogIndex from './pages/BlogIndex.tsx'
import BlogPost from './pages/BlogPost.tsx'
import EncodingTool from './pages/EncodingTool.tsx'
import FakeDataGeneratorRoute from './pages/FakeDataGeneratorRoute.tsx'
import HashGenerator from './pages/HashGenerator.tsx'
import IpCalculator from './pages/IpCalculator.tsx'
import JwtDecoder from './pages/JwtDecoder.tsx'
import ApiPageRoute from './pages/ApiPageRoute.tsx'
import McpPage from './pages/McpPage.tsx'
import MyIp from './pages/MyIp.tsx'
import NanoIdGenerator from './pages/NanoIdGenerator.tsx'
import SubnetPlanner from './pages/SubnetPlanner.tsx'
import PasswordGeneratorRoute from './pages/PasswordGeneratorRoute.tsx'
import TotpToolRoute from './pages/TotpToolRoute.tsx'
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
          <Route path="subnet-planner" element={<SubnetPlanner />} />
          <Route path="my-ip" element={<MyIp />} />
          <Route path="jwt" element={<JwtDecoder />} />
          <Route path="x509" element={<X509Decoder />} />
          <Route path="uuid" element={<UuidGenerator />} />
          <Route path="nanoid" element={<NanoIdGenerator />} />
          <Route path="password" element={<PasswordGeneratorRoute />} />
          <Route path="totp" element={<TotpToolRoute />} />
          <Route path="ulid" element={<UlidGenerator />} />
          <Route path="base64" element={<EncodingTool encoding="base64" />} />
          <Route path="base32" element={<EncodingTool encoding="base32" />} />
          <Route path="base58" element={<EncodingTool encoding="base58" />} />
          <Route path="hash" element={<HashGenerator />} />
          <Route path="fake-data" element={<FakeDataGeneratorRoute />} />
          <Route path="blog" element={<BlogIndex />} />
          <Route path="blog/:slug" element={<BlogPost />} />
          <Route path="api" element={<ApiPageRoute />} />
          <Route path="mcp" element={<McpPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
