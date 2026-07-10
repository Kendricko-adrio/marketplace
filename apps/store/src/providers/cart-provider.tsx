"use client";
import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from "react";
import { useAuth } from "./auth-provider";

interface CartContextType {
  itemCount: number;
  refreshCart: () => Promise<void>;
  loading: boolean;
}

const CartContext = createContext<CartContextType>({
  itemCount: 0,
  refreshCart: async () => {},
  loading: true,
});

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refreshCart = useCallback(async () => {
    if (!isAuthenticated) {
      setItemCount(0);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/cart");
      const data = await res.json();
      if (data.success) {
        // itemCount reflects total quantity across items (sum of quantities),
        // matching how a cart badge typically behaves in e-commerce UIs.
        const totalQty = (data.data?.items ?? []).reduce(
          (sum: number, item: { quantity: number }) => sum + item.quantity,
          0
        );
        setItemCount(totalQty);
      } else {
        setItemCount(0);
      }
    } catch {
      setItemCount(0);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  // Refresh cart count when the tab regains focus, so add-to-cart from
  // other tabs/pages reflects quickly in the navbar badge.
  useEffect(() => {
    const onFocus = () => refreshCart();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshCart]);

  return (
    <CartContext.Provider value={{ itemCount, refreshCart, loading }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}