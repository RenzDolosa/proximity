// Single Supabase client instance, shared by every model/feature/component.
// The SDK itself is vendored locally at Public/Vendor/supabase-js.umd.js
// (loaded as a plain <script> in Public/index.html, exposing `window.supabase`)
// so the app has no runtime dependency on a CDN.

const SUPABASE_URL = 'https://kjwttqmbcjvkivgmwuev.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtqd3R0cW1iY2p2a2l2Z213dWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMDY3NTAsImV4cCI6MjEwNDU4Mjc1MH0.XZwhkCwKilR2o7GOs-UmBlFyPObYt5Z8gUNl3WKLg8Y';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
