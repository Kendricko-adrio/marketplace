import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Helper to generate random ID
function generateId(): string {
  return crypto.randomUUID();
}

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema });

  console.log("🌱 Seeding database...");

  try {
    // Clear existing data
    console.log("🗑️  Clearing existing data...");
    await db.delete(schema.cartItems);
    await db.delete(schema.carts);
    await db.delete(schema.orderItems);
    await db.delete(schema.orders);
    await db.delete(schema.reviews);
    await db.delete(schema.auditLogs);
    await db.delete(schema.productImages);
    await db.delete(schema.productVariants);
    await db.delete(schema.productToCategory);
    await db.delete(schema.products);
    await db.delete(schema.categories);
    await db.delete(schema.vouchers);
    await db.delete(schema.banners);
    await db.delete(schema.addresses);
    await db.delete(schema.sessions);
    await db.delete(schema.accounts);
    await db.delete(schema.verifications);
    await db.delete(schema.users);

    // =====================
    // USERS
    // =====================
    console.log("👤 Creating users...");
    const adminId = generateId();
    const staffId = generateId();
    const customerId = generateId();

    await db.insert(schema.users).values([
      {
        id: adminId,
        name: "Admin Toko",
        email: "admin@store.com",
        emailVerified: true,
        role: "admin",
        image: null,
      },
      {
        id: staffId,
        name: "Staff Gudang",
        email: "staff@store.com",
        emailVerified: true,
        role: "staff",
        image: null,
      },
      {
        id: customerId,
        name: "John Doe",
        email: "john@example.com",
        emailVerified: true,
        role: "customer",
        image: null,
      },
    ]);

    // =====================
    // ADDRESSES
    // =====================
    console.log("📍 Creating addresses...");
    const addressId = generateId();
    await db.insert(schema.addresses).values([
      {
        id: addressId,
        userId: customerId,
        firstName: "John",
        lastName: "Doe",
        phone: "081234567890",
        fullAddress: "Jl. Contoh No. 123, RT 01/RW 02",
        city: "Jakarta Selatan",
        district: "Kebayoran Baru",
        postalCode: "12160",
        isDefault: true,
      },
    ]);

    // =====================
    // CATEGORIES
    // =====================
    console.log("📂 Creating categories...");
    const categoryIds = {
      elektronik: generateId(),
      fashionPria: generateId(),
      fashionWanita: generateId(),
      rumahTangga: generateId(),
      hobi: generateId(),
      otomotif: generateId(),
    };

    await db.insert(schema.categories).values([
      {
        id: categoryIds.elektronik,
        name: "Elektronik",
        slug: "elektronik",
        description: "Gadget, aksesoris komputer, dan elektronik lainnya",
        isActive: true,
      },
      {
        id: categoryIds.fashionPria,
        name: "Fashion Pria",
        slug: "fashion-pria",
        description: "Pakaian dan aksesoris pria",
        isActive: true,
      },
      {
        id: categoryIds.fashionWanita,
        name: "Fashion Wanita",
        slug: "fashion-wanita",
        description: "Pakaian dan aksesoris wanita",
        isActive: true,
      },
      {
        id: categoryIds.rumahTangga,
        name: "Rumah Tangga",
        slug: "rumah-tangga",
        description: "Peralatan dan kebutuhan rumah tangga",
        isActive: true,
      },
      {
        id: categoryIds.hobi,
        name: "Hobi",
        slug: "hobi",
        description: "Perlengkapan hobi dan olahraga",
        isActive: true,
      },
      {
        id: categoryIds.otomotif,
        name: "Otomotif",
        slug: "otomotif",
        description: "Aksesoris dan suku cadang kendaraan",
        isActive: true,
      },
    ]);

    // =====================
    // PRODUCTS WITH VARIANTS
    // =====================
    console.log("📦 Creating products...");

    const productsData = [
      {
        id: generateId(),
        name: "Wireless Headphones Noise Cancelling Premium",
        slug: "wireless-headphones-premium",
        description:
          "Headphone nirkabel dengan teknologi noise cancelling aktif. Kualitas audio premium dengan bass yang dalam dan treble yang jernih. Baterai tahan hingga 30 jam.",
        basePrice: "1200000",
        status: "aktif",
        rating: "4.8",
        sold: 1200,
        isFlashSale: true,
        flashSalePrice: "899000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
        categoryIds: [categoryIds.elektronik],
        variants: [
          {
            color: "Hitam",
            size: null,
            price: "1200000",
            stock: 50,
            sku: "WH-BLK-001",
            isDefault: true,
          },
          {
            color: "Putih",
            size: null,
            price: "1200000",
            stock: 30,
            sku: "WH-WHT-001",
            isDefault: false,
          },
          {
            color: "Navy",
            size: null,
            price: "1250000",
            stock: 20,
            sku: "WH-NVY-001",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Smartwatch Gen 5 Waterproof",
        slug: "smartwatch-gen5-waterproof",
        description:
          "Smartwatch generasi terbaru dengan fitur lengkap. Tahan air hingga 50m, GPS built-in, monitor detak jantung dan SpO2.",
        basePrice: "1500000",
        status: "aktif",
        rating: "4.6",
        sold: 850,
        isFlashSale: true,
        flashSalePrice: "850000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        categoryIds: [categoryIds.elektronik],
        variants: [
          {
            color: "Hitam",
            size: "42mm",
            price: "1500000",
            stock: 40,
            sku: "SW-BLK-42",
            isDefault: true,
          },
          {
            color: "Silver",
            size: "42mm",
            price: "1500000",
            stock: 25,
            sku: "SW-SLV-42",
            isDefault: false,
          },
          {
            color: "Hitam",
            size: "46mm",
            price: "1700000",
            stock: 20,
            sku: "SW-BLK-46",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Mechanical Keyboard RGB Blue Switch",
        slug: "mechanical-keyboard-rgb",
        description:
          "Keyboard mekanikal dengan switch blue tactile. RGB full spectrum dengan software customization. Tahan hingga 50 juta keystroke.",
        basePrice: "800000",
        status: "aktif",
        rating: "4.7",
        sold: 2100,
        isFlashSale: true,
        flashSalePrice: "450000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        categoryIds: [categoryIds.elektronik],
        variants: [
          {
            color: "Hitam",
            size: null,
            price: "800000",
            stock: 60,
            sku: "KB-BLK-001",
            isDefault: true,
          },
          {
            color: "Putih",
            size: null,
            price: "850000",
            stock: 35,
            sku: "KB-WHT-001",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Gaming Mouse Ultra Lightweight",
        slug: "gaming-mouse-lightweight",
        description:
          "Mouse gaming ultra ringan hanya 58g. Sensor optik 25600 DPI dengan 6 tombol yang dapat diprogram.",
        basePrice: "600000",
        status: "aktif",
        rating: "4.5",
        sold: 500,
        isFlashSale: true,
        flashSalePrice: "350000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        categoryIds: [categoryIds.elektronik],
        variants: [
          {
            color: "Hitam",
            size: null,
            price: "600000",
            stock: 80,
            sku: "GM-BLK-001",
            isDefault: true,
          },
          {
            color: "Putih",
            size: null,
            price: "600000",
            stock: 45,
            sku: "GM-WHT-001",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Kaos Polos Cotton Combed 30s Premium",
        slug: "kaos-polos-cotton-premium",
        description:
          "Kaos polos bahan cotton combed 30s yang nyaman dan adem. Tersedia dalam berbagai warna dan ukuran.",
        basePrice: "89000",
        status: "aktif",
        rating: "4.4",
        sold: 3500,
        isFlashSale: false,
        categoryIds: [categoryIds.fashionPria, categoryIds.fashionWanita],
        variants: [
          {
            color: "Hitam",
            size: "S",
            price: "89000",
            stock: 100,
            sku: "KP-BLK-S",
            isDefault: false,
          },
          {
            color: "Hitam",
            size: "M",
            price: "89000",
            stock: 150,
            sku: "KP-BLK-M",
            isDefault: true,
          },
          {
            color: "Hitam",
            size: "L",
            price: "89000",
            stock: 120,
            sku: "KP-BLK-L",
            isDefault: false,
          },
          {
            color: "Hitam",
            size: "XL",
            price: "89000",
            stock: 80,
            sku: "KP-BLK-XL",
            isDefault: false,
          },
          {
            color: "Putih",
            size: "S",
            price: "89000",
            stock: 90,
            sku: "KP-WHT-S",
            isDefault: false,
          },
          {
            color: "Putih",
            size: "M",
            price: "89000",
            stock: 130,
            sku: "KP-WHT-M",
            isDefault: false,
          },
          {
            color: "Putih",
            size: "L",
            price: "89000",
            stock: 100,
            sku: "KP-WHT-L",
            isDefault: false,
          },
          {
            color: "Navy",
            size: "M",
            price: "89000",
            stock: 70,
            sku: "KP-NVY-M",
            isDefault: false,
          },
          {
            color: "Maroon",
            size: "M",
            price: "89000",
            stock: 60,
            sku: "KP-MRN-M",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Laptop Stand Aluminium Adjustable",
        slug: "laptop-stand-aluminium",
        description:
          "Stand laptop berbahan aluminium dengan sudut yang dapat diatur. Mendukung laptop hingga 17 inch.",
        basePrice: "250000",
        status: "aktif",
        rating: "4.3",
        sold: 800,
        isFlashSale: false,
        categoryIds: [categoryIds.elektronik, categoryIds.rumahTangga],
        variants: [
          {
            color: "Silver",
            size: null,
            price: "250000",
            stock: 100,
            sku: "LS-SLV-001",
            isDefault: true,
          },
          {
            color: "Space Gray",
            size: null,
            price: "270000",
            stock: 60,
            sku: "LS-GRY-001",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "USB-C Hub 7-in-1 Multi Port",
        slug: "usb-c-hub-multiport",
        description:
          "USB-C Hub dengan 7 port: HDMI 4K, USB-A x3, USB-C PD, SD card, microSD. Kompatibel dengan MacBook dan laptop USB-C lainnya.",
        basePrice: "350000",
        status: "aktif",
        rating: "4.6",
        sold: 1500,
        isFlashSale: false,
        categoryIds: [categoryIds.elektronik],
        variants: [
          {
            color: "Silver",
            size: null,
            price: "350000",
            stock: 75,
            sku: "HUB-SLV-001",
            isDefault: true,
          },
          {
            color: "Space Gray",
            size: null,
            price: "350000",
            stock: 50,
            sku: "HUB-GRY-001",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Webcam Full HD 1080p Auto Focus",
        slug: "webcam-fullhd-autofocus",
        description:
          "Webcam Full HD 1080p dengan auto focus dan built-in microphone. Ideal untuk video call dan streaming.",
        basePrice: "450000",
        status: "aktif",
        rating: "4.5",
        sold: 600,
        isFlashSale: false,
        categoryIds: [categoryIds.elektronik],
        variants: [
          {
            color: "Hitam",
            size: null,
            price: "450000",
            stock: 40,
            sku: "WC-BLK-001",
            isDefault: true,
          },
        ],
      },
      {
        id: generateId(),
        name: "Desk Organizer Kayu Minimalis",
        slug: "desk-organizer-kayu",
        description:
          "Desk organizer berbahan kayu dengan desain minimalis. Cocok untuk menyimpan alat tulis dan aksesoris meja.",
        basePrice: "175000",
        status: "aktif",
        rating: "4.2",
        sold: 400,
        isFlashSale: false,
        categoryIds: [categoryIds.rumahTangga],
        variants: [
          {
            color: "Natural",
            size: null,
            price: "175000",
            stock: 50,
            sku: "DO-NAT-001",
            isDefault: true,
          },
          {
            color: "Walnut",
            size: null,
            price: "195000",
            stock: 30,
            sku: "DO-WLN-001",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Mousepad XL Gaming Extended",
        slug: "mousepad-xl-gaming",
        description:
          "Mousepad extended ukuran XL (900x400mm). Permukaan halus dengan base anti-slip rubber.",
        basePrice: "120000",
        status: "aktif",
        rating: "4.4",
        sold: 950,
        isFlashSale: false,
        categoryIds: [categoryIds.elektronik, categoryIds.hobi],
        variants: [
          {
            color: "Hitam",
            size: null,
            price: "120000",
            stock: 200,
            sku: "MP-BLK-001",
            isDefault: true,
          },
          {
            color: "Hitam/Merah",
            size: null,
            price: "130000",
            stock: 80,
            sku: "MP-RED-001",
            isDefault: false,
          },
        ],
      },
    ];

    for (const product of productsData) {
      // Insert product
      await db.insert(schema.products).values({
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        basePrice: product.basePrice,
        status: product.status,
        rating: product.rating,
        sold: product.sold,
        isFlashSale: product.isFlashSale,
        flashSalePrice: product.flashSalePrice || null,
        flashSaleEndsAt: product.flashSaleEndsAt || null,
      });

      // Insert product-category relations
      for (const catId of product.categoryIds) {
        await db.insert(schema.productToCategory).values({
          productId: product.id,
          categoryId: catId,
        });
      }

      // Insert variants
      for (const variant of product.variants) {
        const variantId = generateId();
        await db.insert(schema.productVariants).values({
          id: variantId,
          productId: product.id,
          sku: variant.sku,
          color: variant.color,
          size: variant.size,
          price: variant.price,
          stock: variant.stock,
          isDefault: variant.isDefault,
        });

        // Insert placeholder image for each variant
        await db.insert(schema.productImages).values({
          id: generateId(),
          variantId: variantId,
          url: `/images/products/${product.slug}-${
            variant.color?.toLowerCase() || "default"
          }.jpg`,
          displayOrder: 0,
        });
      }
    }

    // =====================
    // VOUCHERS
    // =====================
    console.log("🎟️  Creating vouchers...");
    await db.insert(schema.vouchers).values([
      {
        id: generateId(),
        code: "DISKON10",
        discountType: "percentage",
        value: "10",
        maxDiscount: "50000",
        minPurchase: "50000",
        quota: 100,
        used: 50,
        isActive: true,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
      {
        id: generateId(),
        code: "HMT25RB",
        discountType: "fixed",
        value: "25000",
        maxDiscount: null,
        minPurchase: "100000",
        quota: 50,
        used: 10,
        isActive: true,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        id: generateId(),
        code: "ONGKIRFREE",
        discountType: "shipping",
        value: "20000",
        maxDiscount: "20000",
        minPurchase: "0",
        quota: 200,
        used: 200,
        isActive: false, // Habis
        validFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ]);

    // =====================
    // BANNERS
    // =====================
    console.log("🖼️  Creating banners...");
    await db.insert(schema.banners).values([
      {
        id: generateId(),
        title: "Promo Akhir Tahun - Diskon hingga 70%",
        imageUrl: "/images/banners/promo-akhir-tahun.jpg",
        linkUrl: "/products?promo=akhir-tahun",
        displayOrder: 1,
        isActive: true,
      },
      {
        id: generateId(),
        title: "Flash Sale Elektronik",
        imageUrl: "/images/banners/flash-sale-elektronik.jpg",
        linkUrl: "/products?category=elektronik&flashsale=true",
        displayOrder: 2,
        isActive: true,
      },
      {
        id: generateId(),
        title: "Gratis Ongkir Seluruh Indonesia",
        imageUrl: "/images/banners/gratis-ongkir.jpg",
        linkUrl: "/products",
        displayOrder: 3,
        isActive: false,
      },
    ]);

    // =====================
    // SAMPLE ORDERS
    // =====================
    console.log("🛒 Creating sample orders...");

    // Get a variant ID for order items
    const variants = await db.select().from(schema.productVariants).limit(5);

    const orderStatuses = ["selesai", "proses", "dikirim", "batal", "selesai"];

    for (let i = 0; i < 5; i++) {
      const orderId = generateId();
      const variant = variants[i % variants.length];
      const qty = Math.floor(Math.random() * 3) + 1;
      const subtotal = parseFloat(variant.price) * qty;
      const shipping = 12000;
      const total = subtotal + shipping + 1000;

      await db.insert(schema.orders).values({
        id: orderId,
        userId: customerId,
        addressId: addressId,
        status: orderStatuses[i],
        paymentMethod: i % 2 === 0 ? "qris" : "va",
        paymentStatus: orderStatuses[i] === "batal" ? "failed" : "paid",
        subtotal: subtotal.toString(),
        shippingCost: shipping.toString(),
        discount: "0",
        serviceFee: "1000",
        total: total.toString(),
        shippingCarrier: i % 2 === 0 ? "JNE" : "SiCepat",
        trackingNumber:
          orderStatuses[i] === "dikirim" || orderStatuses[i] === "selesai"
            ? `TRK${Date.now()}${i}`
            : null,
      });

      await db.insert(schema.orderItems).values({
        id: generateId(),
        orderId: orderId,
        variantId: variant.id,
        productName: "Sample Product",
        variantInfo: `${variant.color || ""} ${variant.size || ""}`.trim(),
        price: variant.price,
        quantity: qty,
      });
    }

    // =====================
    // AUDIT LOGS
    // =====================
    console.log("📝 Creating audit logs...");
    await db.insert(schema.auditLogs).values([
      {
        id: generateId(),
        userId: adminId,
        action: "UPDATE_STOCK",
        entityType: "product_variant",
        entityId: variants[0]?.id,
        changes: { stock: { from: 30, to: 50 } },
        ipAddress: "127.0.0.1",
      },
      {
        id: generateId(),
        userId: null,
        action: "BACKUP_DATABASE",
        entityType: "system",
        entityId: null,
        changes: { status: "success" },
        ipAddress: null,
      },
      {
        id: generateId(),
        userId: staffId,
        action: "UPDATE_ORDER_STATUS",
        entityType: "order",
        entityId: "sample-order-id",
        changes: { status: { from: "proses", to: "dikirim" } },
        ipAddress: "192.168.1.100",
      },
    ]);

    console.log("✅ Seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

seed();
