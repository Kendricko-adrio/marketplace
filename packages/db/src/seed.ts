import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
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
    await db.delete(schema.permissions);
    await db.delete(schema.staticPages);
    await db.delete(schema.footerConfig);
    await db.delete(schema.homepageSectionProducts);
    await db.delete(schema.homepageSections);
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
    // ADMIN PERMISSIONS (RBAC defaults)
    // =====================
    // HQ is treated as implicit superuser in application code, so only the
    // "admin" role gets explicit rows here. Default: products + orders with
    // view + edit (edit includes create), no delete, everything else denied.
    console.log("🔒 Seeding admin role permissions...");
    await db.insert(schema.permissions).values([
      {
        id: generateId(),
        role: "admin",
        module: "products",
        canView: true,
        canEdit: true,
        canDelete: false,
      },
      {
        id: generateId(),
        role: "admin",
        module: "orders",
        canView: true,
        canEdit: true,
        canDelete: false,
      },
      {
        id: generateId(),
        role: "admin",
        module: "branches",
        canView: false,
        canEdit: false,
        canDelete: false,
      },
      {
        id: generateId(),
        role: "admin",
        module: "homepage",
        canView: false,
        canEdit: false,
        canDelete: false,
      },
      {
        id: generateId(),
        role: "admin",
        module: "pages",
        canView: false,
        canEdit: false,
        canDelete: false,
      },
      {
        id: generateId(),
        role: "admin",
        module: "users",
        canView: false,
        canEdit: false,
        canDelete: false,
      },
    ]);

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
    const allProductIds: string[] = [];

    // Available product images in /public/images/products
    const productImages = [
      "/images/products/shoes1.webp",
      "/images/products/shoes2.jpg",
      "/images/products/shoes3.jpg",
      "/images/products/shoes4.jpg",
      "/images/products/shoes5.webp",
      "/images/products/shoes6.webp",
    ];

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
      const productIndex = productsData.indexOf(product);

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

      allProductIds.push(product.id);

      // Insert product-category relations
      for (const catId of product.categoryIds) {
        await db.insert(schema.productToCategory).values({
          productId: product.id,
          categoryId: catId,
        });
      }

      // Insert variants
      for (let variantIndex = 0; variantIndex < product.variants.length; variantIndex++) {
        const variant = product.variants[variantIndex];
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

        // Insert multiple images per variant (3-4 images, starting from a
        // rotating offset so different products get different image sets)
        const imageCount = 3 + (variantIndex % 2); // 3 or 4 images
        const startOffset =
          (productIndex * 2 + variantIndex * 3) % productImages.length;

        for (let imgIndex = 0; imgIndex < imageCount; imgIndex++) {
          const imgOffset = (startOffset + imgIndex) % productImages.length;
          await db.insert(schema.productImages).values({
            id: generateId(),
            variantId: variantId,
            url: productImages[imgOffset],
            displayOrder: imgIndex,
          });
        }
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

    // =====================
    // ASSIGN BRANCHES TO ADMIN USERS
    // =====================
    console.log("🔗 Assigning branches to admin users...");
    // admintoko -> Jakarta Pusat (branchIds[0]); hqmanager oversees all (null)
    await db
      .update(schema.users)
      .set({ branchId: branchIds[0] })
      .where(eq(schema.users.id, adminId));
    // HQ manager branchId stays null (oversees all branches)

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
    // HOMEPAGE SECTIONS (CMS)
    // =====================
    console.log("🏠 Creating homepage sections...");
    const announcementId = generateId();
    const bannerId = generateId();
    const carouselId = generateId();
    const promoCardsId = generateId();
    const storeBannerId = generateId();

    await db.insert(schema.homepageSections).values([
      {
        id: announcementId,
        type: "announcement_bar",
        title: null,
        subtitle: null,
        content: {
          message:
            "Gratis ongkir untuk pembelian di atas Rp 200.000!",
          variant: "info",
        },
        displayOrder: 1,
        isActive: true,
      },
      {
        id: bannerId,
        type: "banner",
        title: "Promo Spesial Akhir Tahun",
        subtitle: "Diskon hingga 70% untuk semua produk pilihan",
        content: {
          slides: [
            { imageUrl: "", altText: "Promo Akhir Tahun" },
          ],
          ctaText: "Belanja Sekarang",
          ctaLink: "/products",
          autoRotateIntervalSec: 5,
        },
        displayOrder: 2,
        isActive: true,
      },
      {
        id: carouselId,
        type: "carousel_product",
        title: "Produk Pilihan",
        subtitle: "Produk rekomendasi terbaik untuk Anda",
        content: { mode: "manual" },
        displayOrder: 3,
        isActive: true,
      },
      {
        id: promoCardsId,
        type: "promo_cards",
        title: "Kategori Pilihan",
        subtitle: null,
        content: {
          cards: [
            {
              id: generateId(),
              imageUrl: "",
              title: "New Arrivals",
              filter: { sortOrder: "newest" },
            },
            {
              id: generateId(),
              imageUrl: "",
              title: "Best Seller",
              filter: { sortOrder: "bestseller" },
            },
            {
              id: generateId(),
              imageUrl: "",
              title: "Diskon Spesial",
              filter: { flashSale: true },
            },
          ],
        },
        displayOrder: 4,
        isActive: true,
      },
      {
        id: storeBannerId,
        type: "store_banner",
        title: "Cabang Kami",
        subtitle: "Kunjungi toko fisik kami di kota terdekat",
        content: {},
        displayOrder: 5,
        isActive: true,
      },
    ]);

    // Link 4 products to the carousel section
    const carouselProductIds = allProductIds.slice(0, 4);
    for (let i = 0; i < carouselProductIds.length; i++) {
      await db.insert(schema.homepageSectionProducts).values({
        sectionId: carouselId,
        productId: carouselProductIds[i],
        displayOrder: i + 1,
      });
    }

    // =====================
    // SAMPLE ORDERS (Phase 1 — pickup-in-store model)
    // =====================
    console.log("🛒 Creating sample orders...");

    // Get variants (with product name) for order items
    const variants = await db
      .select({
        id: schema.productVariants.id,
        productId: schema.productVariants.productId,
        color: schema.productVariants.color,
        size: schema.productVariants.size,
        price: schema.productVariants.price,
        productName: schema.products.name,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .limit(5);

    // English statuses for Phase 1 pickup flow
    const orderStatuses = [
      "completed",
      "processing",
      "ready_for_pickup",
      "cancelled",
      "pending_payment",
      "failed_payment",
    ] as const;

    const pickupBranchId = branchIds[0]; // Jakarta Pusat
    const pickupDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
    const pickupTime = "14:00";

    for (let i = 0; i < orderStatuses.length; i++) {
      const orderId = generateId();
      const variant = variants[i % variants.length];
      const qty = Math.floor(Math.random() * 3) + 1;
      const subtotal = parseFloat(variant.price) * qty;
      // Phase 1 = pickup, no shipping cost, no service fee
      const total = subtotal;

      const status = orderStatuses[i];
      const isPaid =
        status !== "cancelled" &&
        status !== "pending_payment" &&
        status !== "failed_payment";
      const hasPickupCode =
        status === "ready_for_pickup" || status === "completed";
      const isFailedPayment = status === "failed_payment";

      // 6-char pickup code (uppercase alphanumeric, no ambiguous chars)
      const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const pickupCode = hasPickupCode
        ? Array.from(
            { length: 6 },
            () => codeChars[Math.floor(Math.random() * codeChars.length)]
          ).join("")
        : null;

      await db.insert(schema.orders).values({
        id: orderId,
        userId: customer1Id,
        branchId: pickupBranchId,
        status,
        paymentMethod: "qris",
        paymentStatus: isPaid
          ? "paid"
          : status === "pending_payment"
          ? "pending"
          : "failed",
        paymentFailureReason: isFailedPayment
          ? "Payment expired — user did not complete payment in time"
          : null,
        midtransFailureStatus: isFailedPayment ? "expire" : null,
        pickupCode,
        pickupDate,
        pickupTime,
        contactPhone: "081234567890",
        contactEmail: "john@example.com",
        subtotal: subtotal.toString(),
        shippingCost: "0",
        discount: "0",
        serviceFee: "0",
        total: total.toString(),
        midtransTransactionId: isPaid
          ? `midtrans-${orderId.slice(0, 12)}`
          : null,
        snapRedirectUrl:
          status === "pending_payment"
            ? "https://app.sandbox.midtrans.com/snap/v3/redirection/dummy-pending-token"
            : null,
        // Phase 2 shipping fields — null for pickup orders
        shippingCarrier: null,
        trackingNumber: null,
        addressId: null,
      });

      await db.insert(schema.orderItems).values({
        id: generateId(),
        orderId: orderId,
        variantId: variant.id,
        productName: variant.productName,
        variantInfo: `${variant.color || ""} ${variant.size || ""}`.trim(),
        price: variant.price,
        quantity: qty,
      });
    }

    // =====================
    // SAMPLE CART (multi-branch — items from different branches)
    // =====================
    console.log("🛒 Creating sample cart (multi-branch)...");
    const cartId = generateId();
    await db.insert(schema.carts).values({
      id: cartId,
      userId: customer1Id,
    });

    // Add 2 items to the cart: 1 from Jakarta Pusat, 1 from Surabaya.
    // The new cart flow allows items from multiple branches; the checkout
    // page groups them by branch and only lets the customer check out one
    // branch's items per order.
    const cartVariant1 = variants[0];
    const cartVariant2 = variants[1] ?? variants[0];
    await db.insert(schema.cartItems).values([
      {
        id: generateId(),
        cartId: cartId,
        variantId: cartVariant1.id,
        branchId: branchIds[0], // Jakarta Pusat
        quantity: 1,
      },
      {
        id: generateId(),
        cartId: cartId,
        variantId: cartVariant2.id,
        branchId: branchIds[1], // Surabaya
        quantity: 2,
      },
    ]);

    // =====================
    // STATIC PAGES (CMS)
    // =====================
    console.log("📄 Creating static pages...");
    await db.insert(schema.staticPages).values([
      {
        id: generateId(),
        slug: "about",
        title: "Tentang Kami",
        content: `# Tentang Kami

Selamat datang di **StoreFront** — destinasi belanja online terpercaya untuk kebutuhan sehari-hari.

## Cerita Kami

StoreFront didirikan pada tahun 2024 dengan misi sederhana: memberikan pengalaman belanja yang **mudah, aman, dan terpercaya** bagi semua orang di Indonesia.

Kami percaya bahwa teknologi seharusnya membuat hidup lebih mudah, bukan lebih rumit. Itulah sebabnya kami membangun platform yang fokus pada:

- **Kemudahan** — navigasi yang intuitif dan proses checkout yang cepat
- **Keamanan** — pembayaran terenkripsi dan perlindungan data pelanggan
- **Kepercayaan** — produk asli, deskripsi jujur, dan layanan pelanggan yang responsif

## Nilai-Nilai Kami

1. Pelanggan adalah prioritas utama
2. Kualitas di atas kuantitas
3. Transparansi dalam setiap transaksi
4. Dukungan untuk UMKM lokal

> "Kami tidak hanya menjual produk, kami membangun kepercayaan."

## Tim Kami

Tim kami terdiri dari profesional yang berpengalaman di bidang e-commerce, teknologi, dan layanan pelanggan. Kami berkomitmen untuk terus berinovasi memberikan yang terbaik untuk Anda.

Terima kasih telah memilih StoreFront. Selamat belanja!`,
        isPublished: true,
        displayOrder: 1,
      },
      {
        id: generateId(),
        slug: "contact",
        title: "Hubungi Kami",
        content: `# Hubungi Kami

Kami selalu siap membantu Anda. Berikut adalah cara untuk menghubungi kami.

## Layanan Pelanggan

| Kanal | Detail | Jam Operasional |
| - | - | - |
| WhatsApp | 0812-3456-7890 | Senin–Sabtu, 09.00–21.00 WIB |
| Email | support@storefront.id | Senin–Jumat, 09.00–18.00 WIB |
| Live Chat | Tersedia di pojok kanan bawah | 24/7 |

## Kantor Pusat

**StoreFront HQ**

Jl. Sudirman No. 45, Gambir

Jakarta Pusat 10110

Indonesia

## Cabang Kami

Kami memiliki cabang di beberapa kota besar:

- Jakarta Pusat
- Surabaya
- Bandung

Kunjungi halaman [Cabang Kami](/branches) untuk informasi lengkap alamat dan jam operasional.

## Pertanyaan Umum

Untuk pertanyaan umum, silakan sampaikan melalui WhatsApp atau email di atas. Tim kami akan merespons dalam **1×24 jam** pada hari kerja.`,
        isPublished: true,
        displayOrder: 2,
      },
      {
        id: generateId(),
        slug: "terms",
        title: "Syarat & Ketentuan",
        content: `# Syarat & Ketentuan

Terakhir diperbarui: 2026

Dengan mengakses dan menggunakan situs ini, Anda menyetujui syarat dan ketentuan berikut.

## 1. Definisi

- **"Kami"**, **"Toko"** merujuk pada StoreFront.
- **"Anda"**, **"Pengguna"** merujuk pada pelanggan yang mengakses situs ini.
- **"Layanan"** merujuk pada platform e-commerce yang disediakan.

## 2. Penggunaan Akun

1. Anda harus berusia minimal 17 tahun atau telah mendapat izin dari wali.
2. Anda wajib memberikan informasi yang akurat saat mendaftar.
3. Anda bertanggung jawab menjaga keamanan kata sandi akun Anda.

## 3. Pembelian & Pembayaran

| Metode | Keterangan |
| - | - |
| QRIS | Pembayaran instan via aplikasi e-wallet atau m-banking |
| Virtual Account | Transfer bank dengan kode unik per transaksi |

- Pesanan diproses setelah pembayaran dikonfirmasi.
- Pembayaran gagal akan dibatalkan otomatis dalam 24 jam.

## 4. Pengiriman

- Estimasi pengiriman 1–5 hari kerja tergantung lokasi.
- Biaya ongkir dihitung berdasarkan berat, volume, dan tujuan.
- Nomor pelacakan akan dikirim setelah pesanan dikirim.

## 5. Pengembalian & Refund

1. Produk dapat dikembalikan dalam 7 hari setelah diterima.
2. Produk harus dalam kondisi asli dan belum digunakan.
3. Refund diproses dalam 3–5 hari kerja setelah verifikasi.

## 6. Privasi Data

Penggunaan data Anda diatur dalam [Kebijakan Privasi](/pages/privacy) kami.

## 7. Perubahan Ketentuan

Kami berhak mengubah syarat dan ketentuan ini kapan saja. Perubahan berlaku sejak dipublikasikan di situs ini.

## 8. Hukum yang Berlaku

Ketentuan ini diatur berdasarkan hukum Republik Indonesia.`,
        isPublished: true,
        displayOrder: 3,
      },
      {
        id: generateId(),
        slug: "privacy",
        title: "Kebijakan Privasi",
        content: `# Kebijakan Privasi

Terakhir diperbarui: 2026

StoreFront menghormati privasi Anda. Kebijakan ini menjelaskan bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi Anda.

## Data yang Kami Kumpulkan

### Data yang Anda Berikan

- **Nama**, **email**, dan **nomor telepon** saat mendaftar
- **Alamat pengiriman** saat melakukan pemesanan
- **Riwayat pembelian** untuk keperluan layanan

### Data yang Dikumpulkan Otomatis

- Alamat IP dan jenis perangkat
- Aktivitas browsing di situs kami
- Cookie dan teknologi pelacakan serupa

## Penggunaan Data

Kami menggunakan data Anda untuk:

1. Memproses dan mengirim pesanan
2. Berkomunikasi mengenai akun dan pesanan
3. Meningkatkan layanan dan pengalaman belanja
4. Mencegah penipuan dan aktivitas ilegal

## Pembagian Data kepada Pihak Ketiga

Kami **tidak menjual** data pribadi Anda. Data hanya dibagikan kepada:

- **Penyedia layanan pengiriman** (untuk mengirim pesanan)
- **Penyedia layanan pembayaran** (untuk memproses transaksi)
- **Otoritas hukum** bila diwajibkan oleh hukum yang berlaku

## Keamanan Data

Kami menerapkan langkah teknis dan organisasi yang wajar untuk melindungi data Anda:

- Enkripsi TLS/SSL pada semua transmisi data
- Penyimpanan kata sandi dalam bentuk *hash* (bcrypt)
- Akses terbatas hanya untuk personel yang berwenang

## Hak Anda

| Hak | Cara Mengajukan |
| - | - |
| Akses data | Email ke privacy@storefront.id |
| Koreksi data | Melalui pengaturan akun atau email |
| Penghapusan akun | Email ke privacy@storefront.id |
| Penolakan pemasaran | Berhenti berlangganan via email |

## Cookie

Situs ini menggunakan cookie untuk menjaga sesi login dan meningkatkan pengalaman. Anda dapat menonaktifkan cookie melalui pengaturan peramban, namun beberapa fitur mungkin tidak berfungsi optimal.

## Perubahan Kebijakan

Kebijakan ini dapat diperbarui sewaktu-waktu. Perubahan akan dipublikasikan di halaman ini.

## Hubungi Kami

Untuk pertanyaan terkait privasi, hubungi email **privacy@storefront.id** dengan subject **Permintaan Privasi**.`,
        isPublished: true,
        displayOrder: 4,
      },
    ]);

    // =====================
    // FOOTER CONFIG (CMS)
    // =====================
    console.log("🦶 Creating footer config...");
    await db.insert(schema.footerConfig).values({
      id: generateId(),
      data: {
        brandName: "StoreFront",
        tagline:
          "Belanja aman, nyaman, dan terpercaya. Temukan produk terbaik dengan harga terbaik hanya di sini.",
        columns: [
          {
            title: "Layanan",
            links: [
              { label: "Bantuan", href: "/help" },
              { label: "Status Pesanan", href: "/status" },
              { label: "Katalog", href: "/catalog" },
              { label: "Cabang Kami", href: "/branches" },
            ],
          },
          {
            title: "Tentang",
            links: [
              { label: "Tentang Kami", href: "/pages/about" },
              { label: "Hubungi Kami", href: "/pages/contact" },
              { label: "Privasi", href: "/pages/privacy" },
              { label: "Syarat & Ketentuan", href: "/pages/terms" },
            ],
          },
        ],
        copyrightText: "© 2026 StoreFront. All rights reserved.",
        socialMedia: [
          {
            platform: "instagram",
            url: "https://instagram.com/storefront",
            enabled: true,
          },
          {
            platform: "facebook",
            url: "https://facebook.com/storefront",
            enabled: true,
          },
          {
            platform: "tiktok",
            url: "https://tiktok.com/@storefront",
            enabled: true,
          },
        ],
      },
      updatedBy: hqId,
    });

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
        changes: { status: { from: "processing", to: "completed" } },
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
