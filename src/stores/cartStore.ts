import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CartLine {
  id: string;
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitPriceMillimes: number;
  modifiers?: string[];
}

export interface CartSnapshot {
  cart: CartLine[];
  note: string;
  firstItemAddedAt: number | null;
}

interface CartState extends CartSnapshot {
  setCart: (cart: CartLine[] | ((current: CartLine[]) => CartLine[])) => void;
  setNote: (note: string) => void;
  clearOrder: () => void;
  restoreOrder: (snapshot: CartSnapshot) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      cart: [],
      note: '',
      firstItemAddedAt: null,
      setCart: (cartOrUpdater) => set((state) => {
        const cart = typeof cartOrUpdater === 'function' ? cartOrUpdater(state.cart) : cartOrUpdater;
        return {
          cart,
          firstItemAddedAt: cart.length > 0 ? state.firstItemAddedAt ?? Date.now() : null,
        };
      }),
      setNote: (note) => set({ note }),
      clearOrder: () => set({ cart: [], note: '', firstItemAddedAt: null }),
      restoreOrder: (snapshot) => set(snapshot),
    }),
    {
      name: '7anouti-pos-cart',
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
    },
  ),
);
