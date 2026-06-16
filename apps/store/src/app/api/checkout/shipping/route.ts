import { NextRequest, NextResponse } from "next/server";

// Mock shipping options
const SHIPPING_OPTIONS = [
  {
    carrier: "JNE",
    service: "Reguler",
    price: 12000,
    eta: "2-3 hari",
    etaDays: 3,
  },
  {
    carrier: "JNE",
    service: "YES",
    price: 24000,
    eta: "1-2 hari",
    etaDays: 2,
  },
  {
    carrier: "SiCepat",
    service: "REG",
    price: 10000,
    eta: "2-3 hari",
    etaDays: 3,
  },
  {
    carrier: "SiCepat",
    service: "BEST",
    price: 25000,
    eta: "1 hari",
    etaDays: 1,
  },
  {
    carrier: "J&T",
    service: "Express",
    price: 15000,
    eta: "2-3 hari",
    etaDays: 3,
  },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const destination = searchParams.get("destination");

    if (!destination) {
      return NextResponse.json(
        { success: false, error: "Destination is required" },
        { status: 400 }
      );
    }

    // Mock: Adjust prices based on destination (simplified)
    const priceMultiplier = destination.toLowerCase().includes("jakarta")
      ? 1
      : destination.toLowerCase().includes("jawa")
      ? 1.2
      : 1.5;

    const options = SHIPPING_OPTIONS.map((option) => ({
      ...option,
      price: Math.round(option.price * priceMultiplier),
      estimatedArrival: new Date(
        Date.now() + option.etaDays * 24 * 60 * 60 * 1000
      ).toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: options,
    });
  } catch (error) {
    console.error("Error fetching shipping options:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch shipping options" },
      { status: 500 }
    );
  }
}
