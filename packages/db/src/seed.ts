import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import { keyId, slugify } from "./ids";
import bcrypt from "bcryptjs";
import { assertSeedEnvironmentSafe } from "./seed-safety";
import { seedCleanupEntries } from "./seed-cleanup";
import { resolveSeedPlan } from "./seed-mode";
import {
  discountContractSystemConfigSeedRows,
  discountImportSystemConfigSeedRows,
  shipmentSystemConfigSeedRows,
} from "./seed-system-config";
import { INITIAL_ROLE_SEED } from "./rbac/seed-defaults";

assertSeedEnvironmentSafe({ NODE_ENV: process.env.NODE_ENV });
const seedPlan = resolveSeedPlan(process.env.SEED_MODE);

// Helper to generate random ID
function generateId(): string {
  return crypto.randomUUID();
}

function calculateSeedPpn(subtotal: number, ratePercent = 11): number {
  const subtotalCents = BigInt(Math.round(subtotal * 100));
  const rateScaled = BigInt(ratePercent * 1_000_000);
  const denominator = BigInt(100) * BigInt(1000000) * BigInt(100);
  return Number((subtotalCents * rateScaled + denominator - BigInt(1)) / denominator);
}

// Generates 40 additional products so the storefront /products page has
// enough data (50 total) to exercise its infinite-scroll UI. Produces the
// same shape as the hand-authored `productsData` entries below; the existing
// insertion loop (products → categories → variants → images) handles the rest.
// All keys are made unique via the loop index — `product.slug`,
// `product.article_number`, and `product_variant.sku` all have UNIQUE
// constraints, so uniqueness here is required, not cosmetic.
function buildGeneratedProducts(categoryIds: {
  sneakers: string;
  runningShoes: string;
  formalShoes: string;
  casualShoes: string;
  sandals: string;
  boots: string;
}) {
  const brandPool = [
    "AirRunner",
    "StreetStyle",
    "OxfordCo",
    "Comfy",
    "HikerPro",
    "Summer",
    "CourtMaster",
    "EasyWalk",
    "TrailBlaze",
    "UrbanCo",
    "NovaStep",
    "TrekFit",
  ];
  const genderPool = ["Unisex", "Men", "Women"];
  const seasonPool = ["SS26", "FW25"];
  const colorPool = [
    "Hitam",
    "Putih",
    "Navy",
    "Abu-abu",
    "Coklat",
    "Hijau Army",
    "Merah",
    "Biru",
  ];
  const sizePool = ["40", "41", "42", "43", "44"];
  const adjectives = [
    "Swift",
    "Urban",
    "Classic",
    "Pro",
    "Elite",
    "Air",
    "Flex",
    "Bold",
    "Prime",
    "Rapid",
    "Trail",
    "Court",
    "Lite",
    "Peak",
    "Retro",
    "Neo",
    "Pure",
    "Wild",
    "Edge",
    "Force",
  ];
  // Collection → category mapping (one category per generated product).
  const collectionToCategory: Record<string, keyof typeof categoryIds> = {
    Running: "runningShoes",
    Lifestyle: "sneakers",
    Formal: "formalShoes",
    Casual: "casualShoes",
    Outdoor: "boots",
    Sandals: "sandals",
    Basketball: "sneakers",
    Trail: "runningShoes",
    Boots: "boots",
  };
  // Collection → noun pool for the generated name. The noun MUST match the
  // category the product is linked to (via collectionToCategory) — a random
  // noun made the category filter look broken ("Peak Sandal 14" under Boots).
  const collectionNouns: Record<string, string[]> = {
    Running: ["Runner", "Trainer", "Dash", "Pace"],
    Lifestyle: ["Sneaker", "Walker", "Glide", "Motion"],
    Formal: ["Oxford", "Court", "Step"],
    Casual: ["Sneaker", "Walker", "Stride", "Trek"],
    Outdoor: ["Boot", "Hiker", "Trek", "Stride"],
    Sandals: ["Sandal", "Slider", "Glide"],
    Basketball: ["Court", "Stride", "Dash"],
    Trail: ["Runner", "Hiker", "Trek"],
    Boots: ["Boot", "Hiker", "Trek"],
  };
  const collectionKeys = Object.keys(collectionToCategory);

  const products: Array<{
    id: string;
    name: string;
    slug: string;
    articleNumber: string;
    brand: string;
    gender: string;
    season: string;
    collection: string;
    description: string;
    basePrice: string;
    status: string;
    categoryIds: string[];
    variants: Array<{
      color: string;
      size: string;
      price: string;
      sku: string;
      isDefault: boolean;
    }>;
  }> = [];

  for (let i = 0; i < 40; i++) {
    const brand = brandPool[i % brandPool.length];
    const gender = genderPool[i % genderPool.length];
    const season = seasonPool[i % seasonPool.length];
    const collection = collectionKeys[i % collectionKeys.length];
    const categoryId = categoryIds[collectionToCategory[collection]];

    const nounPool = collectionNouns[collection];
    // (i + 1) instead of i so the noun never collides with the adjective
    // (e.g. "Court Court 12").
    const name = `${adjectives[i % adjectives.length]} ${
      nounPool[(i + 1) % nounPool.length]
    } ${i + 1}`;
    const slug = slugify(name);
    const articleNumber = `SEED-GEN-${String(i + 11).padStart(3, "0")}`;

    // Cheapest variant net price — varies across products so the price-range
    // and price-sort filters have spread. ~half get a basePrice above the
    // net price (so `hasDiscount` has both sides).
    const minPrice = 400000 + (i % 10) * 75000;
    const basePrice =
      i % 2 === 0 ? minPrice : minPrice + 150000 + (i % 3) * 50000;

    const abbrev = brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
    const color1 = colorPool[i % colorPool.length];
    const color2 = colorPool[(i + 3) % colorPool.length];
    const size1 = sizePool[i % sizePool.length];
    const size2 = sizePool[(i + 2) % sizePool.length];
    const colorAbbr = (c: string) =>
      c.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);

    const variants = [
      {
        color: color1,
        size: size1,
        price: String(minPrice),
        sku: `${abbrev}-${colorAbbr(color1)}-${size1}-${i + 11}`,
        isDefault: true,
      },
      {
        color: color2,
        size: size2,
        price: String(minPrice + (i % 4) * 25000),
        sku: `${abbrev}-${colorAbbr(color2)}-${size2}-${i + 11}`,
        isDefault: false,
      },
    ];

    products.push({
      id: generateId(),
      name,
      slug,
      articleNumber,
      brand,
      gender,
      season,
      collection,
      description: `Model ${name} dari ${brand} — bagian dari koleksi ${collection} musim ${season}. Nyaman untuk pemakaian sehari-hari dengan kualitas yang konsisten.`,
      basePrice: String(basePrice),
      status: "aktif",
      categoryIds: [categoryId],
      variants,
    });
  }

  return products;
}

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema });

  console.log(`🌱 Seeding database in ${seedPlan.mode} mode...`);

  try {
    // Clear existing data
    console.log("🗑️  Clearing existing data...");
    // The discount Offer↔current-revision pointer is RESTRICT in both
    // directions (a live Offer must never lose its published revision), so the
    // pointer is cleared before the FK-ordered DELETE loop below can remove the
    // revisions. Clearing the pointer ALONE is not enough: an enabled/paused/
    // archived Offer without a current revision violates
    // `discount_offer_live_requirements`, so a database that was seeded before
    // and then published a demo Offer would fail the reset. Both the state and
    // the pointer are therefore cleared together for every Offer about to be
    // deleted anyway — a transient, delete-only state that no request reads
    // (this is the development reset path, not an app write: nothing is ever
    // restored to `draft` outside it).
    await db
      .update(schema.discountOffers)
      .set({ state: "draft", currentRevisionId: null });
    // Rows are deleted BEFORE revisions/pointers, so the applied-revision FK and
    // the state/applied CHECK never need a fake `pending` reset (which would now
    // also break the workbook-row CHECKs for parse-failed rows). Only the row's
    // self-referencing retry FK has to be detached first. Delete-only
    // development state; no app request reads it.
    await db
      .update(schema.priceChangeBatchRows)
      .set({ originRetryRowId: null });
    for (const [, table] of seedCleanupEntries) {
      await db.delete(table);
    }

    // =====================
    // ADMIN ROLES (new RBAC Initial Roles)
    // =====================
    // Seeded before users so the user rows can carry their `roleId`
    // assignment. The legacy `role` column and permission table were
    // dropped by migration 0018 (slice 9 cutover).
    console.log("🔑 Seeding initial RBAC roles...");
    const roleIdsBySeedKey = new Map<string, string>();
    for (const roleSeed of INITIAL_ROLE_SEED) {
      const roleId = generateId();
      roleIdsBySeedKey.set(roleSeed.key, roleId);
      await db.insert(schema.adminRoles).values({
        id: roleId,
        key: roleSeed.key,
        name: roleSeed.name,
        isSystem: roleSeed.isSystem,
        version: 1,
      });
      if (roleSeed.grants.length > 0) {
        await db.insert(schema.adminRoleGrants).values(
          roleSeed.grants.map((grant) => ({
            id: generateId(),
            roleId,
            module: grant.module,
            action: grant.action,
            scope: grant.scope,
          }))
        );
      }
    }

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
        roleId: roleIdsBySeedKey.get("admin")!,
        isActive: true,
        image: null,
      },
      {
        id: hqId,
        name: "HQ Manager",
        username: "hqmanager",
        displayUsername: "hqmanager",
        email: "hq@store.com",
        emailVerified: true,
        roleId: roleIdsBySeedKey.get("hq")!,
        isActive: true,
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
        phone: "81234567890",
        birthDate: "2000-01-01",
        gender: "male",
        onboardingCompleted: true,
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
    // Legacy demo address: Shipment hierarchy must be selected and verified
    // through the address book. Never infer provider parents/labels from a
    // postal code or treat the PDF's sample origin as verified destination.
    await db.insert(schema.addresses).values([
      {
        id: addressId,
        userId: customer1Id,
        provinceId: null,
        cityId: null,
        districtId: null,
        areaId: null,
        province: null,
        area: null,
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

    const allVariantIds: string[] = [];
    const allProductIds: string[] = [];
    const branchIds: string[] = [];
    // SKU → variant id for the Markdown fixtures seeded after the catalog
    // (ticket 03). Only the catalog mode creates these rows.
    const seededVariantsBySku = new Map<string, string>();

    if (seedPlan.seedCatalog) {
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
        articleNumber: "SEED-AR-001",
        brand: "AirRunner",
        gender: "Unisex",
        season: "SS26",
        collection: "Running",
        description:
          "Sepatu lari profesional dengan teknologi cushioned sole untuk kenyamanan maksimal. Ringan, breathable, dan cocok untuk marathon maupun jogging harian.",
        basePrice: "1500000",
        status: "aktif",
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
        articleNumber: "SEED-SS-002",
        brand: "StreetStyle",
        gender: "Unisex",
        season: "SS26",
        collection: "Lifestyle",
        description:
          "Sneakers high top dengan desain urban yang stylish. Sol karet anti slip dan upper dari canvas premium. Cocok untuk streetwear dan casual outing.",
        basePrice: "1100000",
        status: "aktif",
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
        articleNumber: "SEED-OX-003",
        brand: "OxfordCo",
        gender: "Men",
        season: "FW25",
        collection: "Formal",
        description:
          "Sepatu formal Oxford berbahan kulit asli dengan jahitan Goodyear welt. Elegan, tahan lama, dan nyaman untuk penggunaan sehari-hari di kantor.",
        basePrice: "1900000",
        status: "aktif",
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
        articleNumber: "SEED-CS-004",
        brand: "Comfy",
        gender: "Unisex",
        season: "SS26",
        collection: "Casual",
        description:
          "Sepatu slip-on bahan canvas yang ringan dan nyaman. Desain minimalis tanpa tali, cocok untuk jalan-jalan santai dan aktivitas harian.",
        basePrice: "590000",
        status: "aktif",
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
        articleNumber: "SEED-MH-005",
        brand: "HikerPro",
        gender: "Unisex",
        season: "FW25",
        collection: "Outdoor",
        description:
          "Boots outdoor dengan sol karet anti slip dan upper dari kulit suede. Tahan air dan cocok untuk hiking di berbagai medan.",
        basePrice: "1350000",
        status: "aktif",
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
        articleNumber: "SEED-SD-006",
        brand: "Summer",
        gender: "Unisex",
        season: "SS26",
        collection: "Sandals",
        description:
          "Sandal slide dengan footbed empuk dan strap yang nyaman. Desain simpel dan ringan, sempurna untuk pantai dan cuaca panas.",
        basePrice: "250000",
        status: "aktif",
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
        articleNumber: "SEED-CB-007",
        brand: "CourtMaster",
        gender: "Men",
        season: "SS26",
        collection: "Basketball",
        description:
          "Sepatu basket dengan ankle support tinggi dan sol yang responsif. Upper dari synthetic leather yang tahan lama dan mudah dibersihkan.",
        basePrice: "1100000",
        status: "aktif",
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
        articleNumber: "SEED-EW-008",
        brand: "EasyWalk",
        gender: "Unisex",
        season: "SS26",
        collection: "Casual",
        description:
          "Sepatu slip-on casual dengan insole memory foam untuk kenyamanan sepanjang hari. Upper dari knit breathable yang fleksibel.",
        basePrice: "550000",
        status: "aktif",
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
        articleNumber: "SEED-TB-009",
        brand: "TrailBlaze",
        gender: "Unisex",
        season: "FW25",
        collection: "Trail",
        description:
          "Sepatu trail running dengan outsole bergerigi untuk cengkeraman maksimal di medan berlumpur dan berbatu. Tahan air dan breathable.",
        basePrice: "950000",
        status: "aktif",
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
        articleNumber: "SEED-UC-010",
        brand: "UrbanCo",
        gender: "Men",
        season: "FW25",
        collection: "Boots",
        description:
          "Chelsea boots berbahan kulit premium dengan elastic side panel. Desain timeless yang cocok untuk formal maupun smart casual.",
        basePrice: "1600000",
        status: "aktif",
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

    // Append 40 generated products (50 total) so the storefront has enough
    // data to exercise the /products infinite-scroll UI. Generated before the
    // brand/gender dimension loop so any new brands/genders they reference
    // are created below.
    productsData.push(...buildGeneratedProducts(categoryIds));

    // Brand & gender dimensions — sync-managed tables, seeded here so demo
    // products can be linked via brandId/genderId. Ids are deterministic
    // (keyId of slug) to match how the sync creates them.
    const brandBySlug = new Map<string, { id: string; name: string }>();
    const genderBySlug = new Map<string, { id: string; name: string }>();
    for (const p of productsData) {
      if (p.brand) {
        const slug = slugify(p.brand);
        if (!brandBySlug.has(slug))
          brandBySlug.set(slug, { id: keyId("soh:brand:", slug), name: p.brand });
      }
      if (p.gender) {
        const slug = slugify(p.gender);
        if (!genderBySlug.has(slug))
          genderBySlug.set(slug, { id: keyId("soh:gender:", slug), name: p.gender });
      }
    }
    if (brandBySlug.size) {
      await db.insert(schema.brands).values(
        [...brandBySlug.values()].map((b) => ({ id: b.id, name: b.name, slug: slugify(b.name) }))
      );
    }
    if (genderBySlug.size) {
      await db.insert(schema.genders).values(
        [...genderBySlug.values()].map((g) => ({ id: g.id, name: g.name, slug: slugify(g.name) }))
      );
    }

    for (const product of productsData) {
      const productIndex = productsData.indexOf(product);

      // Product-level image (card thumbnail) + gallery (JSONB). Mirrors the
      // Jubelio sync's product.thumbnail / product.images fields so seeded
      // products display through the same query path as Jubelio products.
      // Uses the local sample image set; thumbnail == url for these (no
      // separate Jubelio thumbnail variant). See packages/db/src/jubelio-sync.ts.
      const galleryStart = (productIndex * 2) % productImages.length;
      const galleryCount = 3;
      const gallery: { url: string; thumbnail: string; displayOrder: number }[] = [];
      for (let i = 0; i < galleryCount; i++) {
        const p = productImages[(galleryStart + i) % productImages.length];
        gallery.push({ url: p, thumbnail: p, displayOrder: i });
      }

      // Insert product
      await db.insert(schema.products).values({
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        basePrice: product.basePrice,
        status: product.status,
        // Sync-managed fields (nullable; populated by the Jubelio import /
        // webhook for supplier products — seeded here with demo values).
        articleNumber: product.articleNumber,
        brandId: product.brand ? brandBySlug.get(slugify(product.brand))!.id : null,
        genderId: product.gender ? genderBySlug.get(slugify(product.gender))!.id : null,
        season: product.season,
        collection: product.collection,
        thumbnail: gallery[0]?.url ?? null,
        images: gallery,
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
          // Sync-managed fields — supplier barcode + raw discount. Null for seed
          // (admin-created demo products have no supplier master data); populated
          // by the Jubelio import / webhook.
          barcode: null,
          discount: null,
          jubelioItemId: 100_001 + allVariantIds.length,
        });

        // Track variant id for branch stock seeding
        allVariantIds.push(variantId);
        seededVariantsBySku.set(variant.sku, variantId);

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

    branchIds.push(generateId(), generateId(), generateId());

    // Deliberately legacy/unconfigured origins: never invent Shipment hierarchy
    // from free-text cities or Omnichannel IDs. Admin editing requires completion.
    const unconfiguredOrigin = {
      shippingPhone: null, shippingAddress: null, shippingPostalCode: null,
      shippingProvinceId: null, shippingCityId: null, shippingDistrictId: null,
      shippingAreaId: null, shippingProvince: null, shippingCity: null,
      shippingDistrict: null, shippingArea: null,
    };
    await db.insert(schema.branches).values([
      {
        ...unconfiguredOrigin,
        id: branchIds[0],
        name: "Cabang Jakarta Pusat",
        code: "JKT-01",
        jubelioLocationId: 2_001,
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
        ...unconfiguredOrigin,
        id: branchIds[1],
        name: "Cabang Surabaya",
        code: "SRB-01",
        jubelioLocationId: 2_002,
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
        ...unconfiguredOrigin,
        id: branchIds[2],
        name: "Cabang Bandung Dago",
        code: "BDG-01",
        jubelioLocationId: 2_003,
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
    // Every non-Owner Admin User always has exactly one Home Branch. HQ's
    // all-branch reach comes from its all_branches grants, not from a null
    // branch — the Home Branch only pins own-branch scope.
    await db
      .update(schema.users)
      .set({ branchId: branchIds[0] })
      .where(inArray(schema.users.id, [adminId, hqId]));

    console.log("📦 Seeding branch stocks per variant...");
    for (const branchId of branchIds) {
      for (const variantId of allVariantIds) {
        // `availableStock` mirrors the provider snapshot; for seeded fixtures
        // the provider `available` equals on-hand (no on_order/reserved), so
        // the Sales-Order sellable rule sees the same figure.
        const stock = Math.floor(Math.random() * 50) + 5;
        await db.insert(schema.branchStocks).values({
          branchId,
          productVariantId: variantId,
          stock,
          availableStock: stock,
          providerStockSyncedAt: new Date(),
        });
      }
    }

    // The first seeded product ("AirRunner Pro Running Shoes") intentionally
    // has NO stock in any branch — the storefront greys out its card
    // (opacity + disabled link, "Stok Habis" badge). Deterministic fixture for
    // the products E2E spec; the product still exists in the DB.
    const noStockProductId = allProductIds[0];
    await db
      .delete(schema.branchStocks)
      .where(
        inArray(
          schema.branchStocks.productVariantId,
          db
            .select({ id: schema.productVariants.id })
            .from(schema.productVariants)
            .where(eq(schema.productVariants.productId, noStockProductId))
        )
      );

    // =====================
    // MARKDOWN PRICE FIXTURES (ticket 03)
    // =====================
    // Realistic applied history for the demo catalog: one active Markdown that
    // survives a source increase, one fallback (source fell to the stored
    // target), and one restored SKU whose pointer moved to a second revision.
    // The target is NEVER written into `product_variant.price`; only the source
    // is updated afterwards, exactly like a Jubelio master sync would.
    console.log("🏷️  Creating Markdown price fixtures...");
    const markdownBatchId = generateId();
    const markdownActorIdentity = "seed";
    const markdownReason = "Seed demo Markdown (ticket 03)";
    const markdownFixtures = [
      // Active: 850000 → 750000.
      { sku: "SS-WHT-41", action: "set_price", target: "750000", source: "850000" },
      // Active after the source rose to 900000 (target stays stored).
      { sku: "SS-BLK-41", action: "set_price", target: "750000", source: "850000" },
      // Fallback: source later fell to the stored target 1400000.
      { sku: "OX-BLK-41", action: "set_price", target: "1400000", source: "1500000" },
      // Set then restore: the pointer follows the restore revision.
      { sku: "CS-NVY-40", action: "set_price", target: "400000", source: "450000" },
      { sku: "CS-NVY-40", action: "restore_base", target: null, source: "450000" },
    ] as const;
    await db.insert(schema.priceChangeBatches).values({
      id: markdownBatchId,
      actorIdentity: markdownActorIdentity,
      requestKey: "00000000-0000-4000-8000-000000000003",
      fingerprint: "0".repeat(64),
      source: "manual",
      reason: markdownReason,
      state: "applied",
      rowCount: markdownFixtures.length,
      appliedCount: markdownFixtures.length,
      unchangedCount: 0,
      failedCount: 0,
      pendingCount: 0,
    });
    // Actual prior state per SKU, so a restore revision carries the target it
    // released (`previous_*` columns are enforced against the same source).
    const markdownStateBySku = new Map<string, { target: string | null }>();
    for (let index = 0; index < markdownFixtures.length; index += 1) {
      const fixture = markdownFixtures[index];
      const variantId = seededVariantsBySku.get(fixture.sku);
      if (!variantId) throw new Error(`Markdown seed fixture SKU missing: ${fixture.sku}`);
      const rowId = generateId();
      const revisionId = generateId();
      const prior = markdownStateBySku.get(fixture.sku) ?? { target: null };
      const previousTargetUnitPrice = prior.target;
      const previousMarkdownActive =
        previousTargetUnitPrice !== null &&
        Number(previousTargetUnitPrice) < Number(fixture.source);
      const previousEffectiveUnitPrice = previousMarkdownActive
        ? previousTargetUnitPrice!
        : fixture.source;
      const effective = fixture.target ?? fixture.source;
      await db.insert(schema.variantPriceRevisions).values({
        id: revisionId,
        variantId,
        // Monotonic per variant in the real writer; the seeded restore row
        // continues its SKU's history.
        revisionNo: fixture.action === "restore_base" ? 2 : 1,
        action: fixture.action,
        targetUnitPrice: fixture.target,
        sourceUnitPrice: fixture.source,
        effectiveUnitPrice: effective,
        previousTargetUnitPrice,
        previousEffectiveUnitPrice,
        markdownActive: fixture.target !== null,
        previousMarkdownActive,
        batchId: markdownBatchId,
        batchRowId: rowId,
        actorIdentity: markdownActorIdentity,
      });
      await db.insert(schema.priceChangeBatchRows).values({
        id: rowId,
        batchId: markdownBatchId,
        rowNumber: index + 1,
        inputSku: fixture.sku,
        variantId,
        action: fixture.action,
        targetUnitPrice: fixture.target,
        previewJson: {
          stage: "seed",
          sku: fixture.sku,
          source: fixture.source,
          target: fixture.target,
        },
        state: "applied",
        previousTargetUnitPrice,
        previousEffectiveUnitPrice: previousTargetUnitPrice ?? fixture.source,
        previousMarkdownActive: previousTargetUnitPrice !== null,
        sourceUnitPrice: fixture.source,
        targetUnitPriceAfter: fixture.target,
        effectiveUnitPrice: effective,
        markdownActive: fixture.target !== null,
        appliedRevisionId: revisionId,
      });
      markdownStateBySku.set(fixture.sku, { target: fixture.target });
    }
    // One current pointer per marked SKU, pointing at that SKU's latest row.
    const markdownRevisions = await db
      .select({
        id: schema.variantPriceRevisions.id,
        variantId: schema.variantPriceRevisions.variantId,
        revisionNo: schema.variantPriceRevisions.revisionNo,
      })
      .from(schema.variantPriceRevisions)
      .where(eq(schema.variantPriceRevisions.batchId, markdownBatchId));
    for (const revision of markdownRevisions) {
      const existing = await db
        .select({ variantId: schema.variantPriceCurrent.variantId })
        .from(schema.variantPriceCurrent)
        .where(eq(schema.variantPriceCurrent.variantId, revision.variantId))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(schema.variantPriceCurrent).values({
          variantId: revision.variantId,
          revisionId: revision.id,
          version: revision.revisionNo,
        });
      } else {
        await db
          .update(schema.variantPriceCurrent)
          .set({ revisionId: revision.id, version: revision.revisionNo, updatedAt: new Date() })
          .where(eq(schema.variantPriceCurrent.variantId, revision.variantId));
      }
    }
    // Simulate later Jubelio source updates: one increase, one decrease to the
    // stored target. The Markdown targets are untouched.
    await db
      .update(schema.productVariants)
      .set({ price: "900000" })
      .where(eq(schema.productVariants.id, seededVariantsBySku.get("SS-BLK-41")!));
    await db
      .update(schema.productVariants)
      .set({ price: "1400000" })
      .where(eq(schema.productVariants.id, seededVariantsBySku.get("OX-BLK-41")!));

    // =====================
    // BULK MARKDOWN DEMO BATCH (ticket 04)
    // =====================
    // ONE staged bulk batch waiting at the review step: three `pending` rows for
    // SKUs that already exist above. Nothing here writes a revision, moves a
    // current pointer, or touches `product_variant.price`; applying it stays the
    // admin's decision. The preview mirrors the `PriceChangePreview` the admin
    // domain builds at stage time (money as whole-Rupiah strings, `percent` =
    // delta/base with 2 decimals truncated toward zero), using the catalog state
    // created by the fixtures above. Demo only: never seed a real database.
    console.log("🧾 Creating staged bulk Markdown demo batch...");
    const bulkDemoActorIdentity = "seed";
    const bulkDemoBatchId = generateId();
    const bulkDemoFixture = [
      // Active Markdown 850000 → 750000: a fixed target above the current
      // effective price is a real increase (+50000 on 750000 = 6.66%).
      {
        sku: "SS-WHT-41",
        action: "set_price",
        targetUnitPrice: "800000",
        variantLabel: "Putih / 41",
        sourceUnitPrice: "850000",
        storedTargetBefore: "750000",
        effectiveUnitPriceBefore: "750000",
        markdownActiveBefore: true,
        effectiveUnitPriceAfter: "800000",
        delta: "50000",
        direction: "increase",
        percent: "6.66",
      },
      // Source rose to 900000 while the stored target stayed 750000, so the
      // Markdown is still active (−50000 on 750000 = −6.66%).
      {
        sku: "SS-BLK-41",
        action: "set_price",
        targetUnitPrice: "700000",
        variantLabel: "Hitam / 41",
        sourceUnitPrice: "900000",
        storedTargetBefore: "750000",
        effectiveUnitPriceBefore: "750000",
        markdownActiveBefore: true,
        effectiveUnitPriceAfter: "700000",
        delta: "-50000",
        direction: "decrease",
        percent: "-6.66",
      },
      // Fallback: the source fell to the stored target 1400000, so no Markdown is
      // active while the stored target remains (−200000 on 1400000 = −14.28%).
      {
        sku: "OX-BLK-41",
        action: "set_price",
        targetUnitPrice: "1200000",
        variantLabel: "Hitam / 41",
        sourceUnitPrice: "1400000",
        storedTargetBefore: "1400000",
        effectiveUnitPriceBefore: "1400000",
        markdownActiveBefore: false,
        effectiveUnitPriceAfter: "1200000",
        delta: "-200000",
        direction: "decrease",
        percent: "-14.28",
      },
    ] as const;
    const bulkDemoVariantRows = await db
      .select({
        variantId: schema.productVariants.id,
        sku: schema.productVariants.sku,
        productId: schema.products.id,
        productName: schema.products.name,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.productVariants.productId)
      )
      .where(
        inArray(
          schema.productVariants.sku,
          bulkDemoFixture.map((fixture) => fixture.sku)
        )
      );
    const bulkDemoVariantBySku = new Map(
      bulkDemoVariantRows.map((variant) => [variant.sku, variant] as const)
    );
    // `markdownRevisionIdBefore` must match what the projection reports: the
    // revision the current pointer references while Markdown is active, and
    // null on a fallback row.
    const bulkDemoPointerRows = await db
      .select({
        variantId: schema.variantPriceCurrent.variantId,
        revisionId: schema.variantPriceCurrent.revisionId,
      })
      .from(schema.variantPriceCurrent)
      .where(
        inArray(
          schema.variantPriceCurrent.variantId,
          bulkDemoVariantRows.map((variant) => variant.variantId)
        )
      );
    const bulkDemoPointerByVariant = new Map(
      bulkDemoPointerRows.map(
        (pointer) => [pointer.variantId, pointer.revisionId] as const
      )
    );
    await db.insert(schema.priceChangeBatches).values({
      id: bulkDemoBatchId,
      actorIdentity: bulkDemoActorIdentity,
      requestKey: "00000000-0000-4000-8000-000000000004",
      fingerprint: "0".repeat(64),
      source: "bulk",
      reason: "Seed demo bulk Markdown (ticket 04)",
      state: "staged",
      rowCount: bulkDemoFixture.length,
      appliedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      pendingCount: bulkDemoFixture.length,
    });
    await db.insert(schema.priceChangeBatchRows).values(
      bulkDemoFixture.map((fixture, index) => {
        const variant = bulkDemoVariantBySku.get(fixture.sku);
        if (!variant) {
          throw new Error(
            `Bulk Markdown demo SKU missing: ${fixture.sku}`
          );
        }
        return {
          id: generateId(),
          batchId: bulkDemoBatchId,
          rowNumber: index + 1,
          inputSku: fixture.sku,
          variantId: variant.variantId,
          action: fixture.action,
          targetUnitPrice: fixture.targetUnitPrice,
          // Pending rows carry no applied revision and no actual before/after;
          // the preview is explicitly non-authoritative (apply re-reads source).
          previewJson: {
            inputSku: fixture.sku,
            variantId: variant.variantId,
            productId: variant.productId,
            productName: variant.productName,
            variantLabel: fixture.variantLabel,
            action: fixture.action,
            targetUnitPrice: fixture.targetUnitPrice,
            sourceUnitPrice: fixture.sourceUnitPrice,
            storedTargetBefore: fixture.storedTargetBefore,
            effectiveUnitPriceBefore: fixture.effectiveUnitPriceBefore,
            markdownActiveBefore: fixture.markdownActiveBefore,
            // The projection returns a revision id only while Markdown is active
            // (a fallback row keeps the stored target but exposes no coretan).
            markdownRevisionIdBefore: fixture.markdownActiveBefore
              ? (bulkDemoPointerByVariant.get(variant.variantId) ?? null)
              : null,
            effectiveUnitPriceAfter: fixture.effectiveUnitPriceAfter,
            delta: fixture.delta,
            direction: fixture.direction,
            percent: fixture.percent,
            warnings: [] as string[],
          },
          state: "pending" as const,
        };
      })
    );

    // ── Demo workbook upload (ticket 05) ─────────────────────────
    // A staged xlsx batch proves the workbook source/template version and the
    // row-level review data. It writes no revision/pointer and no price.
    console.log("🧾 Creating staged workbook Markdown demo batch...");
    const xlsxDemoBatchId = generateId();
    const xlsxDemoRows = [
      { sku: "SS-WHT-41", action: "set_price", target: "820000" },
      { sku: "CS-NVY-40", action: "restore_base", target: null },
    ] as const;
    await db.insert(schema.priceChangeBatches).values({
      id: xlsxDemoBatchId,
      actorIdentity: "seed",
      requestKey: "00000000-0000-4000-8000-000000000005",
      fingerprint: "0".repeat(64),
      source: "xlsx",
      templateVersion: "OKCIR_MARKDOWN_V1",
      reason: "Seed demo workbook (ticket 05)",
      state: "staged",
      rowCount: xlsxDemoRows.length,
      appliedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      pendingCount: xlsxDemoRows.length,
    });
    await db.insert(schema.priceChangeBatchRows).values(
      xlsxDemoRows.map((fixture, index) => {
        const variantId = seededVariantsBySku.get(fixture.sku);
        if (!variantId) {
          throw new Error(`Workbook demo SKU missing: ${fixture.sku}`);
        }
        return {
          id: generateId(),
          batchId: xlsxDemoBatchId,
          // Workbook data starts at row 3.
          rowNumber: index + 3,
          inputSku: fixture.sku,
          variantId,
          action: fixture.action,
          targetUnitPrice: fixture.target,
          previewJson: {
            inputSku: fixture.sku,
            action: fixture.action,
            targetUnitPrice: fixture.target,
            warnings: [] as string[],
            stage: "seed-workbook",
          },
          state: "pending" as const,
        };
      })
    );
    } else {
      console.log("📦 Skipping catalog, branches, and stock (managed by Jubelio import)...");
    }

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
              title: "Harga Termurah",
              filter: { sortOrder: "priceAsc" },
            },
            {
              id: generateId(),
              imageUrl: "",
              title: "Diskon Spesial",
              filter: { hasDiscount: true },
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

    if (seedPlan.seedCatalogDependentFixtures) {
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
        jubelioItemId: schema.productVariants.jubelioItemId,
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
    let failedPaymentStockFixture:
      | {
          orderId: string;
          variantId: string;
          itemId: number;
          quantity: number;
          description: string;
        }
      | undefined;
    // Durable Jubelio sales-order ledger fixtures (demo mode) — declared
    // before the order loop and populated from real fixture orders below.
    let salesOperationFixture:
      | {
          orderId: string;
          create: { itemId: number; quantity: number; price: number; unit: string };
        }
      | undefined;
    let cancelledSalesFixture:
      | {
          orderId: string;
          create: { itemId: number; quantity: number; price: number; unit: string };
        }
      | undefined;

    for (let i = 0; i < orderStatuses.length; i++) {
      const status = orderStatuses[i];
      const orderId =
        status === "ready_for_pickup"
          ? "90681d15-fc1a-4377-bdb7-1060da208ed6"
          : generateId();
      const variant = variants[i % variants.length];
      const qty = (i % 3) + 1;
      const subtotal = parseFloat(variant.price) * qty;
      // Phase 1 = pickup, no shipping cost or service fee. PPN is an
      // immutable order snapshot calculated after discount (zero in fixtures).
      const ppnRate = 11;
      const ppnAmount = calculateSeedPpn(subtotal, ppnRate);
      const total = subtotal + ppnAmount;

      const isPaid =
        status !== "cancelled" &&
        status !== "pending_payment" &&
        status !== "failed_payment";
      const hasPickupCode =
        status === "ready_for_pickup" || status === "completed";
      const isFailedPayment = status === "failed_payment";

      // Realistic payment metadata: paid fixtures were settled through a
      // variety of Snap methods; unpaid/failed fixtures never recorded one.
      const seedPaymentMethods = [
        "qris",
        "gopay",
        "credit_card",
        "bank_transfer",
      ];
      const paymentMethod = isPaid
        ? seedPaymentMethods[i % seedPaymentMethods.length]
        : null;

      // 6-char pickup code (uppercase alphanumeric, no ambiguous chars)
      const pickupCode = hasPickupCode
        ? status === "ready_for_pickup"
          ? "G4XUNM"
          : "H5YVNP"
        : null;

      await db.insert(schema.orders).values({
        id: orderId,
        userId: customer1Id,
        branchId: pickupBranchId,
        status,
        paymentMethod,
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
        ppnRate: ppnRate.toString(),
        ppnAmount: ppnAmount.toString(),
        total: total.toString(),
        midtransTransactionId: isPaid
          ? `txn-seed-${orderId.slice(0, 12)}`
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
      if (isFailedPayment) {
        failedPaymentStockFixture = {
          orderId,
          variantId: variant.id,
          itemId: variant.jubelioItemId ?? 10_005,
          quantity: qty,
          description: variant.productName,
        };
      }
      // Realistic durable Jubelio sales-order operation fixtures: the paid
      // "completed" order carries a CONFIRMED create (SO id persisted from the
      // independent GET), and the cancelled order carries a CONFIRMED create
      // plus a CONFIRMED pre-invoice cancel. All three keep the at-most-once
      // ledger invariants visible in demo data (status confirmed ⇒
      // salesOrderId present).
      if (status === "completed") {
        salesOperationFixture = {
          orderId,
          create: {
            itemId: variant.jubelioItemId ?? 10_005,
            quantity: qty,
            price: parseFloat(variant.price),
            unit: "Buah",
          },
        };
      }
      if (status === "cancelled") {
        cancelledSalesFixture = {
          orderId,
          create: {
            itemId: variant.jubelioItemId ?? 10_005,
            quantity: qty,
            price: parseFloat(variant.price),
            unit: "Buah",
          },
        };
      }
    }

    if (failedPaymentStockFixture) {
      const reserveId = generateId();
      const releaseId = generateId();
      const payload = {
        locationId: 61,
        items: [
          {
            variantId: failedPaymentStockFixture.variantId,
            itemId: failedPaymentStockFixture.itemId,
            quantity: failedPaymentStockFixture.quantity,
            description: failedPaymentStockFixture.description,
            snapshot: {
              description: failedPaymentStockFixture.description,
              unit: "Buah",
              cost: 125000,
              binId: 611,
              reserveAccountId: 75,
              releaseAccountId: 72,
            },
          },
        ],
      };
      await db.insert(schema.jubelioStockOperations).values([
        {
          id: reserveId,
          orderId: failedPaymentStockFixture.orderId,
          type: "reserve",
          status: "applied",
          note: `${failedPaymentStockFixture.orderId}:${reserveId}`,
          payload,
          remoteAdjustmentId: 7001,
          attemptCount: 1,
        },
        {
          id: releaseId,
          orderId: failedPaymentStockFixture.orderId,
          type: "release",
          status: "manual_review",
          note: `OKCIR_RELEASE:${failedPaymentStockFixture.orderId}:${releaseId}`,
          payload,
          attemptCount: 5,
          lastError: "Seeded release requires operator reconciliation",
        },
      ]);
    }

    // Durable Jubelio sales-order history; cleanup explicitly removes the
    // ledger before orders. Historical confirmed holds are already accounted
    // so crash recovery must not apply these demo stock movements again.
    if (salesOperationFixture || cancelledSalesFixture) {
      console.log("🧾 Seeding Jubelio sales-order operation ledger...");
      const salesOperationRows: Array<
        typeof schema.jubelioSalesOperations.$inferInsert
      > = [];
      if (salesOperationFixture) {
        const operationId = generateId();
        salesOperationRows.push({
          id: operationId,
          orderId: salesOperationFixture.orderId,
          type: "create",
          status: "confirmed",
          reference: `OKCIR_SO_CREATE:${salesOperationFixture.orderId}:${operationId}`,
          payload: {
            type: "create",
            create: {
              contactId: -1,
              customerName: "John Doe",
              locationId: 2_001,
              note: `OKCIR_SO_CREATE:${salesOperationFixture.orderId}:${operationId}`,
              channelStatus: "Belum Bayar",
              items: [
                {
                  itemId: salesOperationFixture.create.itemId,
                  quantity: salesOperationFixture.create.quantity,
                  price: salesOperationFixture.create.price,
                  discAmount: 0,
                  taxAmount: 0,
                  unit: salesOperationFixture.create.unit,
                  taxId: 0,
                },
              ],
            },
          },
          // Confirmed via the independent GET /sales/orders/{id}; the numeric
          // remote identifier is persisted separately from the local order.
          salesOrderId: 69012,
          attemptCount: 1,
          dispatchedAt: new Date(Date.now() - 30 * 60 * 1000),
          confirmedAt: new Date(Date.now() - 29 * 60 * 1000),
          holdAccountedAt: new Date(Date.now() - 29 * 60 * 1000),
        });
      }
      if (cancelledSalesFixture) {
        const createOperationId = generateId();
        const cancelOperationId = generateId();
        salesOperationRows.push(
          {
            id: createOperationId,
            orderId: cancelledSalesFixture.orderId,
            type: "create",
            status: "confirmed",
            reference: `OKCIR_SO_CREATE:${cancelledSalesFixture.orderId}:${createOperationId}`,
            payload: {
              type: "create",
              create: {
                contactId: -1,
                customerName: "John Doe",
                locationId: 2_001,
                note: `OKCIR_SO_CREATE:${cancelledSalesFixture.orderId}:${createOperationId}`,
                channelStatus: "Belum Bayar",
                items: [
                  {
                    itemId: cancelledSalesFixture.create.itemId,
                    quantity: cancelledSalesFixture.create.quantity,
                    price: cancelledSalesFixture.create.price,
                    discAmount: 0,
                    taxAmount: 0,
                    unit: cancelledSalesFixture.create.unit,
                    taxId: 0,
                  },
                ],
              },
            },
            salesOrderId: 69013,
            attemptCount: 1,
            dispatchedAt: new Date(Date.now() - 60 * 60 * 1000),
            confirmedAt: new Date(Date.now() - 59 * 60 * 1000),
            holdAccountedAt: new Date(Date.now() - 59 * 60 * 1000),
          },
          {
            id: cancelOperationId,
            orderId: cancelledSalesFixture.orderId,
            type: "cancel",
            status: "confirmed",
            reference: `OKCIR_SO_CANCEL:${cancelledSalesFixture.orderId}:${cancelOperationId}`,
            payload: {
              type: "cancel",
              cancel: { salesOrderId: 69013 },
            },
            salesOrderId: 69013,
            attemptCount: 1,
            dispatchedAt: new Date(Date.now() - 45 * 60 * 1000),
            confirmedAt: new Date(Date.now() - 44 * 60 * 1000),
            holdAccountedAt: new Date(Date.now() - 44 * 60 * 1000),
          }
        );
      }
      if (salesOperationRows.length > 0) {
        await db.insert(schema.jubelioSalesOperations).values(salesOperationRows);
      }
    }

    // Durable channel-status mirror projection fixture (ticket #03). The
    // completed fixture order passed through ready_for_pickup before
    // completing, so its 'Siap Proses' target is CONFIRMED (observed by the
    // independent post-edit GET) and its full-payload edit snapshot is
    // retained for audit. Cleanup explicitly removes this evidence before
    // its parent order.
    if (salesOperationFixture) {
      const intentId = generateId();
      await db.insert(schema.jubelioChannelStatusIntents).values({
        id: intentId,
        orderId: salesOperationFixture.orderId,
        salesOrderId: 69012,
        targetVersion: 1,
        targetStatus: "Siap Proses",
        status: "confirmed",
        payload: {
          type: "edit",
          edit: {
            salesorderId: 69012,
            salesorderNo: "SO-000069012",
            contactId: -1,
            customerName: "John Doe",
            transactionDate: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
            isTaxIncluded: false,
            note: `OKCIR_SO_CREATE:${salesOperationFixture.orderId}:seed-create`,
            refNo: "",
            locationId: 2001,
            source: 1,
            channelStatus: "Siap Proses",
            subTotal: salesOperationFixture.create.price * salesOperationFixture.create.quantity,
            totalDisc: 0,
            totalTax: 0,
            grandTotal:
              salesOperationFixture.create.price * salesOperationFixture.create.quantity,
            addFee: 0,
            addDisc: 0,
            serviceFee: 0,
            items: [
              {
                salesorderDetailId: 74001,
                itemId: salesOperationFixture.create.itemId,
                quantity: salesOperationFixture.create.quantity,
                price: salesOperationFixture.create.price,
                disc: 0,
                discAmount: 0,
                taxAmount: 0,
                amount:
                  salesOperationFixture.create.price * salesOperationFixture.create.quantity,
                unit: salesOperationFixture.create.unit,
                taxId: 1,
                locationId: 2001,
              },
            ],
          },
        },
        lastObservedStatus: "Siap Proses",
        lastObservedAt: new Date(Date.now() - 28 * 60 * 1000),
        attemptCount: 1,
        dispatchedAt: new Date(Date.now() - 30 * 60 * 1000),
        confirmedAt: new Date(Date.now() - 28 * 60 * 1000),
      });
    }

    // =====================
    // SAMPLE NOTIFICATIONS
    // =====================
    console.log("🔔 Creating sample notifications...");
    const paidOrderRows = await db
      .select({ id: schema.orders.id, branchId: schema.orders.branchId, total: schema.orders.total })
      .from(schema.orders)
      .where(eq(schema.orders.paymentStatus, "paid"))
      .limit(2);

    for (const paidOrder of paidOrderRows) {
      if (!paidOrder.branchId) continue;
      await db.insert(schema.notifications).values({
        id: generateId(),
        type: "order_paid",
        orderId: paidOrder.id,
        branchId: paidOrder.branchId,
        title: "Order Paid",
        message: `Order #${paidOrder.id.slice(0, 8).toUpperCase()} has been paid and is ready for pickup.`,
        isRead: false,
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
    } else {
      console.log("🛒 Skipping catalog-dependent orders, notifications, and cart...");
    }

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
              { label: "Bantuan", href: "/pages/contact" },
              { label: "Status Pesanan", href: "/account" },
              { label: "Katalog", href: "/products" },
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
          {
            platform: "whatsapp",
            url: "https://wa.me/6281234567890",
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
    if (seedPlan.seedCatalogDependentFixtures) {
      await db.insert(schema.auditLogs).values([
        {
          id: generateId(),
          userId: adminId,
          action: "UPDATE_STOCK",
          entityType: "product_variant",
          entityId: allVariantIds[0] ?? null,
          changes: { stock: { from: 30, to: 50 } },
          ipAddress: "127.0.0.1",
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
    }
    await db.insert(schema.auditLogs).values({
      id: generateId(),
      userId: null,
      action: "BACKUP_DATABASE",
      entityType: "system",
      entityId: null,
      changes: { status: "success" },
      ipAddress: null,
    });

    // =====================
    // SYSTEM CONFIG
    // =====================
    console.log("⚙️  Creating system config...");
    await db.insert(schema.systemConfig).values([
      {
        key: "reservation.ttlMinutes",
        value: "15",
        type: "number",
        description:
          "Menit TTL reservasi stok saat customer menunggu pembayaran QRIS di Midtrans Snap. Setelah TTL, order dianggap expired dan reservasi dilepas (oleh webhook expire Midtrans / cron sweep).",
      },
      ...shipmentSystemConfigSeedRows,
      ...discountImportSystemConfigSeedRows,
      ...discountContractSystemConfigSeedRows,
      {
        key: "tax.ppnRatePercent",
        value: "11",
        type: "number",
        description:
          "Customer PPN percentage. Applied after discounts and rounded upward to a whole Rupiah. Restart the store application after changing this value.",
      },
    ]);

    if (seedPlan.seedCatalogDependentFixtures) {
    // =====================
    // DISCOUNT ADMINISTRATION (ticket 06) — ONE demo public draft
    // =====================
    // A clearly INCOMPLETE public fixed Offer draft: realistic name/terms on
    // the single unpublished draft revision, but NO quota, NO budget, NO
    // current revision pointer, NO benefit and NO code — so it can never be
    // launched, reserved or redeemed. The usage projection starts at zero with
    // no invented customer usage and no opening balance, and
    // Kontrak diskon aktif pada database seed lokal/demo; draft ini tetap
    // tidak aktif karena belum dipublish. Data ini bergantung pada katalog, jadi
    // `SEED_MODE=jubelio` must not invent a campaign next to synced catalog.
    console.log("🏷️  Creating one incomplete public discount draft...");
    const demoDiscountOfferId = generateId();
    const demoDiscountOfferRevisionId = generateId();
    const demoDiscountOfferNow = new Date();
    await db.insert(schema.discountOffers).values({
      id: demoDiscountOfferId,
      key: generateId(),
      activationKind: "public",
      state: "draft",
      currentRevisionId: null,
      version: 1,
      draftVersion: 1,
      quotaCount: null,
      budgetAmount: null,
      perClientLimit: 1,
      policyVersion: 1,
      actorId: hqId,
      actorIdentity: hqId,
      createdAt: demoDiscountOfferNow,
      updatedAt: demoDiscountOfferNow,
    });
    await db.insert(schema.discountOfferRevisions).values({
      id: demoDiscountOfferRevisionId,
      offerId: demoDiscountOfferId,
      revisionNo: 1,
      name: "Diskon Rp25.000 Sepatu Pilihan (draft)",
      currency: "IDR",
      minSubtotal: "0",
      startAt: null,
      endAt: null,
      schemaVersion: 1,
      engineVersion: 1,
      draftVersion: 1,
      publishedAt: null,
      actorId: hqId,
      actorIdentity: hqId,
      createdAt: demoDiscountOfferNow,
      updatedAt: demoDiscountOfferNow,
    });
    await db.insert(schema.discountOfferUsage).values({
      offerId: demoDiscountOfferId,
      reservedCount: 0,
      consumedCount: 0,
      reservedAmount: "0",
      consumedAmount: "0",
      version: 1,
      updatedAt: demoDiscountOfferNow,
    });

    // =====================
    // REDEMPTION LIFECYCLE DEMO (ticket 07)
    // =====================
    // ONE published/enabled public fixed-goods Offer plus three Redemption
    // snapshots that agree with their counters:
    //   completed  → consumed (counts)
    //   pending    → reserved (counts)
    //   failed     → released (capacity returned, retained as evidence)
    // Gate aktif untuk database seed lokal/demo, bukan aktivasi rollout
    // staging/production; tidak ada provider row yang dibuat. Markdown 0 di sini;
    // ticket03 membuat proyeksi Markdown secara terpisah.
    console.log("🎟️  Creating one published demo Coupon and Redemption snapshots...");
    const demoVariantRows = await db
      .select({
        id: schema.productVariants.id,
        price: schema.productVariants.price,
        productName: schema.products.name,
      })
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .limit(1);
    if (demoVariantRows.length > 0 && Number(demoVariantRows[0].price) > 0) {
      const demoVariant = demoVariantRows[0];
      const demoGoods = Number(demoVariant.price);
      const demoCoupon = Math.min(25_000, demoGoods);
      const demoNet = demoGoods - demoCoupon;
      const demoPpn = calculateSeedPpn(demoNet, 11);
      const demoTotal = demoNet + demoPpn;
      const demoOfferId = generateId();
      const demoRevisionId = generateId();
      const demoBenefitId = generateId();
      const demoNow = new Date();
      const demoDeadline = new Date(demoNow.getTime() + 15 * 60_000);

      await db.insert(schema.discountOffers).values({
        id: demoOfferId,
        key: generateId(),
        activationKind: "public",
        // Draft first: the current-revision pointer has a composite FK to the
        // revision, so the revision must exist before the pointer is set.
        state: "draft",
        currentRevisionId: null,
        version: 1,
        draftVersion: 1,
        quotaCount: null,
        budgetAmount: null,
        perClientLimit: 1,
        policyVersion: 1,
        actorId: hqId,
        actorIdentity: hqId,
        createdAt: demoNow,
        updatedAt: demoNow,
      });
      await db.insert(schema.discountOfferRevisions).values({
        id: demoRevisionId,
        offerId: demoOfferId,
        revisionNo: 1,
        name: "Kupon Demo Rp25.000",
        currency: "IDR",
        minSubtotal: "0",
        startAt: null,
        endAt: null,
        schemaVersion: 1,
        engineVersion: 1,
        draftVersion: 1,
        publishedAt: demoNow,
        actorId: hqId,
        actorIdentity: hqId,
        createdAt: demoNow,
        updatedAt: demoNow,
      });
      await db.insert(schema.discountBenefits).values({
        id: demoBenefitId,
        revisionId: demoRevisionId,
        kind: "fixed_goods",
        scope: "goods",
        fixedAmount: String(demoCoupon),
        paramsVersion: 1,
        createdAt: demoNow,
      });
      await db.update(schema.discountOffers).set({
        state: "enabled",
        currentRevisionId: demoRevisionId,
        quotaCount: 50,
        budgetAmount: "1000000",
        updatedAt: demoNow,
      }).where(eq(schema.discountOffers.id, demoOfferId));
      await db.insert(schema.discountOfferUsage).values({
        offerId: demoOfferId,
        reservedCount: 1,
        consumedCount: 1,
        reservedAmount: String(demoCoupon),
        consumedAmount: String(demoCoupon),
        version: 3,
        updatedAt: demoNow,
      });
      await db.insert(schema.discountClientUsage).values({
        offerId: demoOfferId,
        clientId: customer1Id,
        reservedCount: 1,
        consumedCount: 1,
        reservedAmount: String(demoCoupon),
        consumedAmount: String(demoCoupon),
        version: 3,
        updatedAt: demoNow,
      });

      const demoRedemptionStates = [
        { status: "completed", paymentStatus: "paid", redemption: "consumed" },
        { status: "pending_payment", paymentStatus: "pending", redemption: "reserved" },
        { status: "failed_payment", paymentStatus: "failed", redemption: "released" },
      ] as const;
      for (const demo of demoRedemptionStates) {
        const orderId = generateId();
        const orderItemId = generateId();
        await db.insert(schema.orders).values({
          id: orderId,
          userId: customer1Id,
          branchId: branchIds[0],
          status: demo.status,
          paymentMethod: demo.paymentStatus === "paid" ? "qris" : null,
          paymentStatus: demo.paymentStatus,
          pickupCode: demo.status === "completed" ? "K7M2QP" : null,
          pickupDate: new Date(demoNow.getTime() + 24 * 60 * 60_000),
          pickupTime: "14:00",
          contactPhone: "081234567890",
          contactEmail: "john@example.com",
          subtotal: String(demoGoods),
          shippingCost: "0",
          discount: String(demoCoupon),
          serviceFee: "0",
          ppnRate: "11",
          ppnAmount: String(demoPpn),
          total: String(demoTotal),
          expiresAt: demo.status === "pending_payment" ? demoDeadline : null,
        });
        await db.insert(schema.orderItems).values({
          id: orderItemId,
          orderId,
          variantId: demoVariant.id,
          productName: demoVariant.productName,
          price: String(demoGoods),
          quantity: 1,
        });
        const redemptionId = generateId();
        await db.insert(schema.discountRedemptions).values({
          id: redemptionId,
          orderId,
          clientId: customer1Id,
          offerId: demoOfferId,
          revisionId: demoRevisionId,
          benefitId: demoBenefitId,
          activationKind: "public",
          status: demo.redemption,
          benefitAmount: String(demoCoupon),
          deadline: demoDeadline,
          policyVersion: 1,
          termsSnapshot: {
            name: "Kupon Demo Rp25.000",
            minSubtotal: "0",
            startAt: null,
            endAt: null,
          },
          resultSnapshot: {
            version: 1,
            offerId: demoOfferId,
            revisionId: demoRevisionId,
            benefitId: demoBenefitId,
            benefitAmount: String(demoCoupon),
          },
          consumedAt: demo.redemption === "consumed" ? demoNow : null,
          releasedAt: demo.redemption === "released" ? demoNow : null,
          terminalReason:
            demo.redemption === "released"
              ? "Sales Order cancel confirmed before invoice"
              : null,
          releaseSource:
            demo.redemption === "released" ? "jubelio-cancel" : null,
          createdAt: demoNow,
          updatedAt: demoNow,
        });
        await db.insert(schema.discountRedemptionEvents).values({
          id: generateId(),
          redemptionId,
          eventKey: `${redemptionId}:reserved`,
          kind: "reserved",
          previousStatus: null,
          nextStatus: "reserved",
          amount: String(demoCoupon),
          source: "checkout",
          createdAt: demoNow,
        });
        if (demo.redemption === "consumed") {
          await db.insert(schema.discountRedemptionEvents).values({
            id: generateId(),
            redemptionId,
            eventKey: `${redemptionId}:consumed`,
            kind: "consumed",
            previousStatus: "reserved",
            nextStatus: "consumed",
            amount: String(demoCoupon),
            source: "midtrans",
            createdAt: demoNow,
          });
        }
        if (demo.redemption === "released") {
          await db.insert(schema.discountRedemptionEvents).values({
            id: generateId(),
            redemptionId,
            eventKey: `${redemptionId}:released`,
            kind: "released",
            previousStatus: "reserved",
            nextStatus: "released",
            amount: String(demoCoupon),
            source: "jubelio-cancel",
            reason: "Sales Order cancel confirmed before invoice",
            createdAt: demoNow,
          });
        }
        await db.insert(schema.orderDiscountAllocations).values({
          id: generateId(),
          orderId,
          orderItemId,
          component: "offer_goods",
          redemptionId,
          benefitId: demoBenefitId,
          amount: String(demoCoupon),
          createdAt: demoNow,
        });
      }

      // =====================
      // Manual Promo Code demo (ticket 09). Activation kind is identity: a
      // manual_only Offer has reserved canonical codes and shares the SAME
      // quota/budget/per-account projection. One code is inactive to show that
      // retired codes stay reserved forever; one consumed Redemption names the
      // code the customer actually used.
      const manualOfferId = generateId();
      const manualRevisionId = generateId();
      const manualBenefitId = generateId();
      const manualCodeActiveId = generateId();
      const manualCodeInactiveId = generateId();
      await db.insert(schema.discountOffers).values({
        id: manualOfferId,
        key: generateId(),
        activationKind: "manual_only",
        state: "draft",
        currentRevisionId: null,
        version: 1,
        draftVersion: 1,
        quotaCount: null,
        budgetAmount: null,
        perClientLimit: 1,
        policyVersion: 1,
        actorId: hqId,
        actorIdentity: hqId,
        createdAt: demoNow,
        updatedAt: demoNow,
      });
      await db.insert(schema.discountOfferRevisions).values({
        id: manualRevisionId,
        offerId: manualOfferId,
        revisionNo: 1,
        name: "Kode Manual Demo Rp25.000",
        currency: "IDR",
        minSubtotal: "0",
        startAt: null,
        endAt: null,
        schemaVersion: 1,
        engineVersion: 1,
        draftVersion: 1,
        publishedAt: demoNow,
        actorId: hqId,
        actorIdentity: hqId,
        createdAt: demoNow,
        updatedAt: demoNow,
      });
      await db.insert(schema.discountBenefits).values({
        id: manualBenefitId,
        revisionId: manualRevisionId,
        kind: "fixed_goods",
        scope: "goods",
        fixedAmount: String(demoCoupon),
        paramsVersion: 1,
        createdAt: demoNow,
      });
      await db.update(schema.discountOffers).set({
        state: "enabled",
        currentRevisionId: manualRevisionId,
        quotaCount: 5,
        budgetAmount: "1000000",
        updatedAt: demoNow,
      }).where(eq(schema.discountOffers.id, manualOfferId));
      await db.insert(schema.discountCodes).values([
        {
          id: manualCodeActiveId,
          offerId: manualOfferId,
          activationKind: "manual_only",
          canonicalCode: "HEMAT17AGUSTUS",
          state: "active",
          version: 1,
          publishedAt: demoNow,
          actorId: hqId,
          actorIdentity: hqId,
          createdAt: demoNow,
          updatedAt: demoNow,
        },
        {
          id: manualCodeInactiveId,
          offerId: manualOfferId,
          activationKind: "manual_only",
          canonicalCode: "PROMO2026OFF",
          state: "inactive",
          version: 2,
          publishedAt: demoNow,
          actorId: hqId,
          actorIdentity: hqId,
          createdAt: demoNow,
          updatedAt: demoNow,
        },
      ]);
      await db.insert(schema.discountOfferUsage).values({
        offerId: manualOfferId,
        reservedCount: 0,
        consumedCount: 1,
        reservedAmount: "0",
        consumedAmount: String(demoCoupon),
        version: 2,
        updatedAt: demoNow,
      });
      await db.insert(schema.discountClientUsage).values({
        offerId: manualOfferId,
        clientId: customer1Id,
        reservedCount: 0,
        consumedCount: 1,
        reservedAmount: "0",
        consumedAmount: String(demoCoupon),
        version: 2,
        updatedAt: demoNow,
      });
      {
        const orderId = generateId();
        const orderItemId = generateId();
        await db.insert(schema.orders).values({
          id: orderId,
          userId: customer1Id,
          branchId: branchIds[0],
          status: "completed",
          paymentMethod: "qris",
          paymentStatus: "paid",
          pickupCode: "M4N7QA",
          pickupDate: new Date(demoNow.getTime() + 24 * 60 * 60_000),
          pickupTime: "14:00",
          contactPhone: "081234567890",
          contactEmail: "john@example.com",
          subtotal: String(demoGoods),
          shippingCost: "0",
          discount: String(demoCoupon),
          serviceFee: "0",
          ppnRate: "11",
          ppnAmount: String(demoPpn),
          total: String(demoTotal),
        });
        await db.insert(schema.orderItems).values({
          id: orderItemId,
          orderId,
          variantId: demoVariant.id,
          productName: demoVariant.productName,
          price: String(demoGoods),
          quantity: 1,
        });
        const redemptionId = generateId();
        await db.insert(schema.discountRedemptions).values({
          id: redemptionId,
          orderId,
          clientId: customer1Id,
          offerId: manualOfferId,
          revisionId: manualRevisionId,
          benefitId: manualBenefitId,
          activationKind: "manual_only",
          codeId: manualCodeActiveId,
          status: "consumed",
          benefitAmount: String(demoCoupon),
          deadline: demoDeadline,
          policyVersion: 1,
          termsSnapshot: {
            name: "Kode Manual Demo Rp25.000",
            minSubtotal: "0",
            startAt: null,
            endAt: null,
          },
          resultSnapshot: {
            version: 1,
            offerId: manualOfferId,
            revisionId: manualRevisionId,
            benefitId: manualBenefitId,
            activationKind: "manual_only",
            codeId: manualCodeActiveId,
            benefitAmount: String(demoCoupon),
          },
          consumedAt: demoNow,
          createdAt: demoNow,
          updatedAt: demoNow,
        });
        await db.insert(schema.discountRedemptionEvents).values([
          {
            id: generateId(),
            redemptionId,
            eventKey: `${redemptionId}:reserved`,
            kind: "reserved",
            previousStatus: null,
            nextStatus: "reserved",
            amount: String(demoCoupon),
            source: "checkout",
            createdAt: demoNow,
          },
          {
            id: generateId(),
            redemptionId,
            eventKey: `${redemptionId}:consumed`,
            kind: "consumed",
            previousStatus: "reserved",
            nextStatus: "consumed",
            amount: String(demoCoupon),
            source: "midtrans",
            createdAt: demoNow,
          },
        ]);
        await db.insert(schema.orderDiscountAllocations).values({
          id: generateId(),
          orderId,
          orderItemId,
          component: "offer_goods",
          redemptionId,
          benefitId: manualBenefitId,
          amount: String(demoCoupon),
          createdAt: demoNow,
        });
      }
    }
    // Percentage goods demo (ticket 10): rate 10% dengan cap Rp20.000.
    // Gate tetap 0; ini baris demo untuk picker/simulasi, bukan aktivasi rollout.
    if (demoVariantRows.length > 0) {
      const percentOfferId = generateId();
      const percentRevisionId = generateId();
      const percentNow = new Date();
      await db.insert(schema.discountOffers).values({
        id: percentOfferId,
        key: generateId(),
        activationKind: "public",
        state: "draft",
        currentRevisionId: null,
        version: 1,
        draftVersion: 1,
        quotaCount: null,
        budgetAmount: null,
        perClientLimit: 1,
        policyVersion: 1,
        actorId: hqId,
        actorIdentity: hqId,
        createdAt: percentNow,
        updatedAt: percentNow,
      });
      await db.insert(schema.discountOfferRevisions).values({
        id: percentRevisionId,
        offerId: percentOfferId,
        revisionNo: 1,
        name: "Diskon Demo 10% (maks Rp20.000)",
        currency: "IDR",
        minSubtotal: "0",
        startAt: null,
        endAt: null,
        schemaVersion: 1,
        engineVersion: 1,
        draftVersion: 1,
        publishedAt: percentNow,
        actorId: hqId,
        actorIdentity: hqId,
        createdAt: percentNow,
        updatedAt: percentNow,
      });
      await db.insert(schema.discountBenefits).values({
        id: generateId(),
        revisionId: percentRevisionId,
        kind: "percentage_goods",
        scope: "goods",
        rate: "10.000000",
        capAmount: "20000",
        paramsVersion: 1,
        createdAt: percentNow,
      });
      await db
        .update(schema.discountOffers)
        .set({
          state: "enabled",
          currentRevisionId: percentRevisionId,
          quotaCount: 50,
          budgetAmount: "1000000",
          updatedAt: percentNow,
        })
        .where(eq(schema.discountOffers.id, percentOfferId));
      await db.insert(schema.discountOfferUsage).values({
        offerId: percentOfferId,
      });

      // Shipping subsidy demos (ticket 11): satu Offer publik dan satu Offer
      // manual dengan kode, keduanya cap positif tanpa rate/fixed goods. Gate
      // tetap 0; baris demo untuk picker/simulasi, bukan aktivasi rollout.
      const shippingOffers = [
        {
          keyName: "Subsidi Ongkir Demo Rp20.000",
          activationKind: "public",
          capAmount: "20000",
          quotaCount: 50,
          code: null,
        },
        {
          keyName: "Kode Subsidi Ongkir Demo Rp15.000",
          activationKind: "manual_only",
          capAmount: "15000",
          quotaCount: 5,
          code: "ONGKIRHEMAT",
        },
      ];
      for (const shippingOffer of shippingOffers) {
        const shippingOfferId = generateId();
        const shippingRevisionId = generateId();
        const shippingNow = new Date();
        await db.insert(schema.discountOffers).values({
          id: shippingOfferId,
          key: generateId(),
          activationKind: shippingOffer.activationKind,
          state: "draft",
          currentRevisionId: null,
          version: 1,
          draftVersion: 1,
          quotaCount: null,
          budgetAmount: null,
          perClientLimit: 1,
          policyVersion: 1,
          actorId: hqId,
          actorIdentity: hqId,
          createdAt: shippingNow,
          updatedAt: shippingNow,
        });
        await db.insert(schema.discountOfferRevisions).values({
          id: shippingRevisionId,
          offerId: shippingOfferId,
          revisionNo: 1,
          name: shippingOffer.keyName,
          currency: "IDR",
          minSubtotal: "0",
          startAt: null,
          endAt: null,
          schemaVersion: 1,
          engineVersion: 1,
          draftVersion: 1,
          publishedAt: shippingNow,
          actorId: hqId,
          actorIdentity: hqId,
          createdAt: shippingNow,
          updatedAt: shippingNow,
        });
        await db.insert(schema.discountBenefits).values({
          id: generateId(),
          revisionId: shippingRevisionId,
          kind: "shipping",
          scope: "shipping",
          capAmount: shippingOffer.capAmount,
          paramsVersion: 1,
          createdAt: shippingNow,
        });
        await db.update(schema.discountOffers).set({
          state: "enabled",
          currentRevisionId: shippingRevisionId,
          quotaCount: shippingOffer.quotaCount,
          budgetAmount: "1000000",
          updatedAt: shippingNow,
        }).where(eq(schema.discountOffers.id, shippingOfferId));
        await db.insert(schema.discountOfferUsage).values({
          offerId: shippingOfferId,
        });
        if (shippingOffer.code) {
          await db.insert(schema.discountCodes).values({
            id: generateId(),
            offerId: shippingOfferId,
            activationKind: "manual_only",
            canonicalCode: shippingOffer.code,
            state: "active",
            version: 1,
            publishedAt: shippingNow,
            actorId: hqId,
            actorIdentity: hqId,
            createdAt: shippingNow,
            updatedAt: shippingNow,
          });
        }
      }
    }
    }


    console.log("✅ Seeding completed successfully!");
    console.log("");
    console.log("🔑 Admin credentials:");
    console.log("  admintoko / admin123   (Role: Admin)");
    console.log("  hqmanager / hq123      (Role: HQ)");
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
