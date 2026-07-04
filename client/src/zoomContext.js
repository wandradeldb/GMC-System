import { createContext, useContext } from 'react';

export const ZoomContext = createContext(100);
export const useZoom = () => useContext(ZoomContext);
