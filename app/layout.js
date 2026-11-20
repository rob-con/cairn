import '@fontsource-variable/lora';
import '@fontsource-variable/inter';
import './globals.css';
import { VaultProvider } from '../lib/VaultContext';

export const metadata = {
  title: 'Cairn',
  description: 'A calm place to leave things in order for the people you love.',
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: '#2b3844' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <VaultProvider>{children}</VaultProvider>
      </body>
    </html>
  );
}
