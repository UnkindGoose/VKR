import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import meta from '../../assets/models/MobileNetV2-TSM-Bukva/meta.json';


const MODELS_DIR = FileSystem.documentDirectory + 'models/';

const initial_models = [{
  name: 'MobileNetV2-TSM-Bukva',
  modelAsset: require('../../assets/models/MobileNetV2-TSM-Bukva/model.tflite'),
  labelsAsset: require('../../assets/models/MobileNetV2-TSM-Bukva/labels.txt'),
  metaAsset: require('../../assets/models/MobileNetV2-TSM-Bukva/meta.json'),
}];


export async function ensureModelsDir() {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }


  for (const model of initial_models) {

    const modelDir = `${MODELS_DIR}${model.name}/`;
    const modelFile = `${modelDir}model.tflite`;
    const labelsFile = `${modelDir}labels.txt`;
    const metaFile = `${modelDir}meta.json`;

    const [dirInfo, modelInfo, labelsInfo, metaInfo] = await Promise.all([
      FileSystem.getInfoAsync(modelDir),
      FileSystem.getInfoAsync(modelFile),
      FileSystem.getInfoAsync(labelsFile),
      FileSystem.getInfoAsync(metaFile),
    ]);

    const isComplete = dirInfo.exists && modelInfo.exists && labelsInfo.exists && metaInfo.exists;


    if (!isComplete) {
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
      }

      const modelAsset = Asset.fromModule(model.modelAsset);
      await modelAsset.downloadAsync();
      await FileSystem.copyAsync({
        from: modelAsset.localUri!,
        to: modelFile,
      });

      const labelsAsset = Asset.fromModule(model.labelsAsset);
      await labelsAsset.downloadAsync();
      await FileSystem.copyAsync({
        from: labelsAsset.localUri!,
        to: labelsFile,
      });

      const metaFile = `${modelDir}meta.json`;
      await FileSystem.writeAsStringAsync(metaFile, JSON.stringify(meta));

      let retry = 5;
      while (retry-- > 0) {
        const info = await FileSystem.getInfoAsync(metaFile);
        if (info.exists) break;
        await new Promise(res => setTimeout(res, 100));
      }

      console.log(`Модель ${model.name} успешно установлена`);
    }
    else {
      console.log(`Модель ${model.name} уже существует`);
    }
  }
}



export async function downloadModelFromSupabase(modelName: string): Promise<void> {
  const modelDir = `${MODELS_DIR}${modelName}/`;
  const info = await FileSystem.getInfoAsync(modelDir);

  if (!info.exists){
    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });
    console.log("Создание папки для модели, ", modelName);
  }

  const files = ['model.tflite', 'labels.txt', 'meta.json'];
  for (const file of files) {
    const { data, error } = await supabase.storage
      .from('models')
      .download(`${modelName}/${file}`);
    if (error || !data) throw new Error(`Ошибка загрузки файла ${file}: ${error?.message}`);

    const fileUri = `${modelDir}${file}`;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result?.toString().split(',')[1];
      if (base64) {
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      }
    };
    reader.readAsDataURL(data);
  }
}



export async function listDownloadedModels(): Promise<string[]> {
  const modelDirs = await FileSystem.readDirectoryAsync(MODELS_DIR);

  return modelDirs;
}



export async function readLocalModelMeta(modelFolder: string): Promise<{
  id: string;
  language: string;
} | null> {
  try {
    const metaPath = `${MODELS_DIR}${modelFolder}/meta.json`;
    const info = await FileSystem.getInfoAsync(metaPath);
    if (!info.exists) {
      console.log(`Мета файл ${modelFolder} не найден`)
      return null;
    }

    const json = await FileSystem.readAsStringAsync(metaPath);
    const meta = JSON.parse(json);
  
    return { id: String(meta.id), language: String(meta.language) };
  } catch {
    return null;
  }
}

