import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useSettings } from './hooks/data';
import { applyDisplaySettings } from './lib/theme';
import Library from './screens/Library';
import ChapterList from './screens/ChapterList';
import CardPicker from './screens/CardPicker';
import Reader from './screens/Reader';
import Bookmarks from './screens/Bookmarks';
import SettingsScreen from './screens/Settings';
import NotFound from './screens/NotFound';

export default function App() {
  const settings = useSettings();

  useEffect(() => {
    applyDisplaySettings(settings);
  }, [settings]);

  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/book/:bookId" element={<ChapterList />} />
      <Route path="/book/:bookId/chapter/:chapterNumber" element={<CardPicker />} />
      <Route path="/book/:bookId/read/:cardNumber" element={<Reader />} />
      <Route path="/bookmarks" element={<Bookmarks />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
