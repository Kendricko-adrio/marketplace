import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import bcrypt from "bcryptjs";

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
    await db.delete(schema.branchStocks);
    await db.delete(schema.productImages);
    await db.delete(schema.productVariants);
    await db.delete(schema.productToCategory);
    await db.delete(schema.products);
    await db.delete(schema.categories);
    await db.delete(schema.branches);
    await db.delete(schema.vouchers);
    await db.delete(schema.banners);
    await db.delete(schema.addresses);
    await db.delete(schema.clientSessions);
    await db.delete(schema.clientAccounts);
    await db.delete(schema.clientVerifications);
    await db.delete(schema.clients);
    await db.delete(schema.adminSessions);
    await db.delete(schema.adminAccounts);
    await db.delete(schema.adminVerifications);
    await db.delete(schema.users);

    // =====================
    // ADMIN USERS
    // =====================
    console.log("👤 Creating admin users...");
    const adminId = generateId();
    const hqId = generateId();

    await db.insert(schema.users).values([
      {
        id: adminId,
        name: "Admin Toko",
        username: "admintoko",
        displayUsername: "admintoko",
        email: "admin@store.com",
        emailVerified: true,
        role: "admin",
        image: null,
      },
      {
        id: hqId,
        name: "HQ Manager",
        username: "hqmanager",
        displayUsername: "hqmanager",
        email: "hq@store.com",
        emailVerified: true,
        role: "hq",
        image: null,
      },
    ]);

    // =====================
    // ADMIN ACCOUNTS (with passwords for email/username + password login)
    // =====================
    console.log("🔐 Creating admin accounts with passwords...");
    const adminCredentials = [
      { userId: adminId, password: "admin123" },
      { userId: hqId, password: "hq123" },
    ];

    for (const cred of adminCredentials) {
      const hashedPassword = await bcrypt.hash(cred.password, 10);
      await db.insert(schema.adminAccounts).values({
        id: generateId(),
        userId: cred.userId,
        accountId: cred.userId,
        providerId: "credential",
        password: hashedPassword,
      });
    }

    // =====================
    // CLIENTS (store customers)
    // =====================
    console.log("👤 Creating clients...");
    const customer1Id = generateId();
    const customer2Id = generateId();

    await db.insert(schema.clients).values([
      {
        id: customer1Id,
        name: "John Doe",
        email: "john@example.com",
        emailVerified: true,
        image: null,
      },
      {
        id: customer2Id,
        name: "Jane Smith",
        email: "jane@example.com",
        emailVerified: true,
        image: null,
      },
    ]);

    // =====================
    // CLIENT ACCOUNTS (with passwords for email + password login)
    // =====================
    console.log("🔐 Creating client accounts with passwords...");
    const clientCredentials = [
      { userId: customer1Id, password: "password123" },
      { userId: customer2Id, password: "password123" },
    ];

    for (const cred of clientCredentials) {
      const hashedPassword = await bcrypt.hash(cred.password, 10);
      await db.insert(schema.clientAccounts).values({
        id: generateId(),
        userId: cred.userId,
        accountId: cred.userId,
        providerId: "credential",
        password: hashedPassword,
      });
    }

    // =====================
    // ADDRESSES
    // =====================
    console.log("📍 Creating addresses...");
    const addressId = generateId();
    await db.insert(schema.addresses).values([
      {
        id: addressId,
        userId: customer1Id,
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
      sneakers: generateId(),
      runningShoes: generateId(),
      formalShoes: generateId(),
      casualShoes: generateId(),
      sandals: generateId(),
      boots: generateId(),
    };

    await db.insert(schema.categories).values([
      {
        id: categoryIds.sneakers,
        name: "Sneakers",
        slug: "sneakers",
        description: "Koleksi sneakers trendy dan nyaman untuk gaya sehari-hari",
        icon: "Footprints",
        isActive: true,
      },
      {
        id: categoryIds.runningShoes,
        name: "Running Shoes",
        slug: "running-shoes",
        description: "Sepatu lari dengan teknologi terbaik untuk performa maksimal",
        icon: "Zap",
        isActive: true,
      },
      {
        id: categoryIds.formalShoes,
        name: "Formal Shoes",
        slug: "formal-shoes",
        description: "Sepatu formal elegan untuk acara resmi dan kantor",
        icon: "Briefcase",
        isActive: true,
      },
      {
        id: categoryIds.casualShoes,
        name: "Casual Shoes",
        slug: "casual-shoes",
        description: "Sepatu casual yang nyaman untuk aktivitas santai",
        icon: "Shirt",
        isActive: true,
      },
      {
        id: categoryIds.sandals,
        name: "Sandals",
        slug: "sandals",
        description: "Sandal stylish dan nyaman untuk cuaca panas",
        icon: "Sun",
        isActive: true,
      },
      {
        id: categoryIds.boots,
        name: "Boots",
        slug: "boots",
        description: "Boots kokoh dan tahan lama untuk petualangan",
        icon: "Mountain",
        isActive: true,
      },
    ]);

    // =====================
    // PRODUCTS WITH VARIANTS
    // =====================
    console.log("📦 Creating products...");

    const allVariantIds: string[] = [];

    const productsData = [
      {
        id: generateId(),
        name: "AirRunner Pro Running Shoes",
        slug: "airrunner-pro-running-shoes",
        description:
          "Sepatu lari profesional dengan teknologi cushioned sole untuk kenyamanan maksimal. Ringan, breathable, dan cocok untuk marathon maupun jogging harian.",
        basePrice: "1200000",
        status: "aktif",
        rating: "4.8",
        sold: 1200,
        isFlashSale: true,
        flashSalePrice: "899000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
        categoryIds: [categoryIds.runningShoes],
        variants: [
          {
            color: "Hitam",
            size: "42",
            price: "1200000",
            sku: "AR-BLK-42",
            isDefault: true,
          },
          {
            color: "Putih",
            size: "42",
            price: "1200000",
            sku: "AR-WHT-42",
            isDefault: false,
          },
          {
            color: "Hitam",
            size: "44",
            price: "1250000",
            sku: "AR-BLK-44",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "StreetStyle High Top Sneakers",
        slug: "streetstyle-high-top-sneakers",
        description:
          "Sneakers high top dengan desain urban yang stylish. Sol karet anti slip dan upper dari canvas premium. Cocok untuk streetwear dan casual outing.",
        basePrice: "850000",
        status: "aktif",
        rating: "4.6",
        sold: 850,
        isFlashSale: true,
        flashSalePrice: "650000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        categoryIds: [categoryIds.sneakers],
        variants: [
          {
            color: "Putih",
            size: "41",
            price: "850000",
            sku: "SS-WHT-41",
            isDefault: true,
          },
          {
            color: "Hitam",
            size: "41",
            price: "850000",
            sku: "SS-BLK-41",
            isDefault: false,
          },
          {
            color: "Putih",
            size: "43",
            price: "850000",
            sku: "SS-WHT-43",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Classic Leather Oxford Formal",
        slug: "classic-leather-oxford-formal",
        description:
          "Sepatu formal Oxford berbahan kulit asli dengan jahitan Goodyear welt. Elegan, tahan lama, dan nyaman untuk penggunaan sehari-hari di kantor.",
        basePrice: "1500000",
        status: "aktif",
        rating: "4.7",
        sold: 600,
        isFlashSale: true,
        flashSalePrice: "1200000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        categoryIds: [categoryIds.formalShoes],
        variants: [
          {
            color: "Hitam",
            size: "41",
            price: "1500000",
            sku: "OX-BLK-41",
            isDefault: true,
          },
          {
            color: "Coklat",
            size: "42",
            price: "1500000",
            sku: "OX-BRN-42",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Comfy Canvas Slip-On Casual",
        slug: "comfy-canvas-slip-on-casual",
        description:
          "Sepatu slip-on bahan canvas yang ringan dan nyaman. Desain minimalis tanpa tali, cocok untuk jalan-jalan santai dan aktivitas harian.",
        basePrice: "450000",
        status: "aktif",
        rating: "4.5",
        sold: 2100,
        isFlashSale: true,
        flashSalePrice: "350000",
        flashSaleEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        categoryIds: [categoryIds.casualShoes],
        variants: [
          {
            color: "Navy",
            size: "40",
            price: "450000",
            sku: "CS-NVY-40",
            isDefault: true,
          },
          {
            color: "Abu-abu",
            size: "41",
            price: "450000",
            sku: "CS-GRY-41",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Mountain Hiker Outdoor Boots",
        slug: "mountain-hiker-outdoor-boots",
        description:
          "Boots outdoor dengan sol karet anti slip dan upper dari kulit suede. Tahan air dan cocok untuk hiking di berbagai medan.",
        basePrice: "1350000",
        status: "aktif",
        rating: "4.4",
        sold: 750,
        isFlashSale: false,
        categoryIds: [categoryIds.boots],
        variants: [
          {
            color: "Coklat",
            size: "42",
            price: "1350000",
            sku: "MH-BRN-42",
            isDefault: true,
          },
          {
            color: "Hitam",
            size: "43",
            price: "1350000",
            sku: "MH-BLK-43",
            isDefault: false,
          },
          {
            color: "Coklat",
            size: "44",
            price: "1400000",
            sku: "MH-BRN-44",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Summer Slide Comfort Sandals",
        slug: "summer-slide-comfort-sandals",
        description:
          "Sandal slide dengan footbed empuk dan strap yang nyaman. Desain simpel dan ringan, sempurna untuk pantai dan cuaca panas.",
        basePrice: "250000",
        status: "aktif",
        rating: "4.3",
        sold: 1500,
        isFlashSale: false,
        categoryIds: [categoryIds.sandals],
        variants: [
          {
            color: "Hitam",
            size: "41",
            price: "250000",
            sku: "SD-BLK-41",
            isDefault: true,
          },
          {
            color: "Navy",
            size: "42",
            price: "250000",
            sku: "SD-NVY-42",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Court Master Basketball Sneakers",
        slug: "court-master-basketball-sneakers",
        description:
          "Sepatu basket dengan ankle support tinggi dan sol yang responsif. Upper dari synthetic leather yang tahan lama dan mudah dibersihkan.",
        basePrice: "1100000",
        status: "aktif",
        rating: "4.6",
        sold: 950,
        isFlashSale: false,
        categoryIds: [categoryIds.sneakers],
        variants: [
          {
            color: "Hitam/Merah",
            size: "43",
            price: "1100000",
            sku: "CB-BRD-43",
            isDefault: true,
          },
          {
            color: "Putih/Biru",
            size: "42",
            price: "1100000",
            sku: "CB-WBL-42",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Easy Walk Slip-On Casual",
        slug: "easy-walk-slip-on-casual",
        description:
          "Sepatu slip-on casual dengan insole memory foam untuk kenyamanan sepanjang hari. Upper dari knit breathable yang fleksibel.",
        basePrice: "550000",
        status: "aktif",
        rating: "4.5",
        sold: 1800,
        isFlashSale: false,
        categoryIds: [categoryIds.casualShoes],
        variants: [
          {
            color: "Hitam",
            size: "41",
            price: "550000",
            sku: "EW-BLK-41",
            isDefault: true,
          },
          {
            color: "Abu-abu",
            size: "42",
            price: "550000",
            sku: "EW-GRY-42",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Trail Blazer All-Terrain Running",
        slug: "trail-blazer-all-terrain-running",
        description:
          "Sepatu trail running dengan outsole bergerigi untuk cengkeraman maksimal di medan berlumpur dan berbatu. Tahan air dan breathable.",
        basePrice: "950000",
        status: "aktif",
        rating: "4.7",
        sold: 650,
        isFlashSale: false,
        categoryIds: [categoryIds.runningShoes],
        variants: [
          {
            color: "Hijau Army",
            size: "42",
            price: "950000",
            sku: "TB-GRN-42",
            isDefault: true,
          },
          {
            color: "Abu-abu",
            size: "43",
            price: "950000",
            sku: "TB-GRY-43",
            isDefault: false,
          },
        ],
      },
      {
        id: generateId(),
        name: "Urban Chelsea Leather Boots",
        slug: "urban-chelsea-leather-boots",
        description:
          "Chelsea boots berbahan kulit premium dengan elastic side panel. Desain timeless yang cocok untuk formal maupun smart casual.",
        basePrice: "1600000",
        status: "aktif",
        rating: "4.8",
        sold: 420,
        isFlashSale: false,
        categoryIds: [categoryIds.boots, categoryIds.formalShoes],
        variants: [
          {
            color: "Hitam",
            size: "41",
            price: "1600000",
            sku: "UC-BLK-41",
            isDefault: true,
          },
          {
            color: "Coklat",
            size: "42",
            price: "1600000",
            sku: "UC-BRN-42",
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
          isDefault: variant.isDefault,
        });

        // Track variant id for branch stock seeding
        allVariantIds.push(variantId);

        // Insert placeholder image for each variant
        await db.insert(schema.productImages).values({
          id: generateId(),
          variantId: variantId,
          url: '/images/products/shoes1.webp',
          displayOrder: 0,
        });
      }
    }

    // =====================
    // BRANCHES + BRANCH STOCKS
    // =====================
    console.log("🏢 Creating branches...");

    const standardHours = { open: "09:00", close: "21:00" };
    const branchOperatingHours = {
      monday: standardHours,
      tuesday: standardHours,
      wednesday: standardHours,
      thursday: standardHours,
      friday: standardHours,
      saturday: standardHours,
      sunday: null,
    };

    const branchIds = [generateId(), generateId(), generateId()];

    await db.insert(schema.branches).values([
      {
        id: branchIds[0],
        name: "Cabang Jakarta Pusat",
        code: "JKT-01",
        city: "Jakarta Pusat",
        address: "Jl. Sudirman No. 45, Gambir, Jakarta Pusat 10110",
        latitude: "-6.1944",
        longitude: "106.8229",
        operatingHours: branchOperatingHours,
        googleMapsUrl:
          "https://www.google.com/maps/search/?api=1&query=-6.1944,106.8229",
        status: "aktif",
      },
      {
        id: branchIds[1],
        name: "Cabang Surabaya",
        code: "SRB-01",
        city: "Surabaya",
        address: "Jl. Tunjungan No. 80, Genteng, Surabaya 60275",
        latitude: "-7.2575",
        longitude: "112.7521",
        operatingHours: branchOperatingHours,
        googleMapsUrl:
          "https://www.google.com/maps/search/?api=1&query=-7.2575,112.7521",
        status: "aktif",
      },
      {
        id: branchIds[2],
        name: "Cabang Bandung Dago",
        code: "BDG-01",
        city: "Bandung",
        address: "Jl. Ir. H. Juanda No. 101, Coblong, Bandung 40135",
        latitude: "-6.8888",
        longitude: "107.6111",
        operatingHours: branchOperatingHours,
        googleMapsUrl: null,
        status: "nonaktif",
      },
    ]);

    console.log("📦 Seeding branch stocks per variant...");
    for (const branchId of branchIds) {
      for (const variantId of allVariantIds) {
        await db.insert(schema.branchStocks).values({
          branchId,
          productVariantId: variantId,
          stock: Math.floor(Math.random() * 50) + 5,
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
        title: "Promo Akhir Tahun Sepatu - Diskon hingga 70%",
        imageUrl: "/images/banners/promo-akhir-tahun.jpg",
        linkUrl: "/products?promo=akhir-tahun",
        displayOrder: 1,
        isActive: true,
      },
      {
        id: generateId(),
        title: "Flash Sale Sneakers",
        imageUrl: "/images/banners/flash-sale-sneakers.jpg",
        linkUrl: "/products?category=sneakers&flashsale=true",
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
        userId: customer1Id,
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
        userId: hqId,
        action: "UPDATE_ORDER_STATUS",
        entityType: "order",
        entityId: "sample-order-id",
        changes: { status: { from: "proses", to: "dikirim" } },
        ipAddress: "192.168.1.100",
      },
    ]);

    console.log("✅ Seeding completed successfully!");
    console.log("");
    console.log("🔑 Admin credentials:");
    console.log("  admintoko / admin123   (role: admin)");
    console.log("  hqmanager / hq123      (role: hq)");
    console.log("  Email login also works: admin@store.com / admin123, hq@store.com / hq123");
    console.log("");
    console.log("🛒 Client credentials:");
    console.log("  john@example.com / password123");
    console.log("  jane@example.com / password123");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

seed();
