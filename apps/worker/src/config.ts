export interface Config {
  databaseUrl: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");
  return { databaseUrl };
}
