// supabase/models.ts
import { createClient } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

export const MODEL_BUCKET = 'models';

export interface ModelMetadata {
  id: string;
  name: string;
  language: string;
}