import * as React from 'react'
import { Text, View, StyleSheet, TouchableOpacity, Dimensions, Platform, StatusBar, ActivityIndicator } from "react-native";
import { useState, useEffect } from 'react';
import {
  Camera,
  useCameraDevice,
  CameraPosition,
  useCameraPermission,
  useFrameProcessor,
  runAtTargetFps,
  runAsync,
} from 'react-native-vision-camera'
import {
  Tensor,
  TensorflowModel,
  useTensorflowModel,
  loadTensorflowModel,
} from 'react-native-fast-tflite'
import { useResizePlugin } from 'vision-camera-resize-plugin'
import FontAwesome6 from '@react-native-vector-icons/fontawesome6';
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core';
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import NetInfo from '@react-native-community/netinfo';

import LanguageModelPicker, { ModelItem } from './modelPopUp';
import { supabase } from './utils/supabase';
import { listDownloadedModels, downloadModelFromSupabase, readLocalModelMeta, ensureModelsDir } from './utils/fileUtils';
import type * as Worklets from 'react-native-worklets-core'
//import { StatusBar } from 'expo-status-bar';


const windowWidth = Dimensions.get('screen').width;
const windowHeight = Dimensions.get('screen').height;

const FRAME_INTERVAL = 5;

type FullModelItem = ModelItem & {
  id: string;
  name: string;
  language: string;
  downloaded: boolean;
};

function tensorToString(tensor: Tensor): string {
  return `\n  - ${tensor.dataType} ${tensor.name}[${tensor.shape}]`
}

function modelToString(model: TensorflowModel): string {
  return (
    `TFLite Model (${model.delegate}):\n` +
    `- Inputs: ${model.inputs.map(tensorToString).join('')}\n` +
    `- Outputs: ${model.outputs.map(tensorToString).join('')}`
  )
}


export default function Index() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [deviceDir, setDeviceDir] = useState<CameraPosition>('front');
  const device = useCameraDevice(deviceDir);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [models, setModels] = useState<FullModelItem[]>([]);
  const [currentModel, setCurrentModel] = useState<TensorflowModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  const { resize } = useResizePlugin()

  const togglePicker = () => setPickerVisible((v) => !v);

  const [translation, setTranslation] = useState('');
  const passTranslation = useRunOnJS((translation) => {
    setTranslation(translation);
  });


  const [labels, setLabels] = useState<string[]>([]);

  const loadModel = async (modelName: string) => {
    console.log("▶️ loadModel called with:", modelName);

    const modelPath = `${FileSystem.documentDirectory}models/${modelName}/model.tflite`;
    const labelsPath = `${FileSystem.documentDirectory}models/${modelName}/labels.txt`;
    

    const modelInfo = await FileSystem.getInfoAsync(modelPath);
    if (!modelInfo.exists) {
      await downloadModelFromSupabase(modelName);
    }
  
    const model = await loadTensorflowModel({ url: modelPath });
    if (model){
      setCurrentModel(model);
      console.log(`Model loaded! Shape:\n${modelToString(model)}]`);
      
    }
    else{
      console.log("Model is undefined");
      setCurrentModel(null);
    };
    
    const labelsContent = await FileSystem.readAsStringAsync(labelsPath);
    setLabels(labelsContent.split('\n'));
    console.log("Labels loaded!");
  };

  const loadModelList = async () => {
    try {

      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected && netState.isInternetReachable;
  
      const localFolders = await listDownloadedModels();
      console.log(localFolders);

      const localMetas = await Promise.all(
        localFolders.map(async (folder) => {
          const meta = await readLocalModelMeta(folder);
          return meta
            ? {
                folder,
                id: meta.id,
                language: meta.language,
                name: folder,
              }
            : null;
        })
      );
  
      const localModels = localMetas.filter(
        (m): m is { folder: string; id: string; language: string; name: string } => m !== null
      );
  
      let combined: FullModelItem[] = [];
  
      if (isOnline) {

        const { data: serverModels, error } = await supabase
          .from('Models')
          .select('id, model_language, model_name');
  
        if (error) throw error;
  
        combined = serverModels.map((sm) => ({
          id: sm.id,
          name: sm.model_name,
          language: sm.model_language,
          downloaded: localFolders.includes(sm.model_name),
        }));
  
        localModels.forEach((lm) => {
          if (!combined.some((cm) => cm.id === lm.id)) {
            combined.push({
              id: lm.id,
              name: lm.name,
              language: lm.language,
              downloaded: true,
            });
          }
        });
      } else {
        combined = localModels.map((lm) => ({
          id: lm.id,
          name: lm.name,
          language: lm.language,
          downloaded: true,
        }));
      }
  
      combined.sort((a, b) => {
        if (a.downloaded !== b.downloaded) {
          return a.downloaded ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  
      setModels(combined);
      if (combined.length > 0) {
        setSelectedModelId(combined[0].id);
      }
    } catch (e) {
      console.error('Ошибка при загрузке моделей:', e);
    } finally {
      console.log("Список моделей готов");
    }
  };

  useEffect(() => {
    async function prepare() {
      try {
        await ensureModelsDir();
        await loadModelList();
        loadModel("MobileNetV2-TSM-Bukva");
      } catch (e) {
        console.warn(e);
      } finally {
        setLoading(false);
      }
    }

    prepare();
    
  }, []);


  useEffect(() => {
    requestPermission()
  }, [requestPermission])

  function toggleCameraFacing() {
    setDeviceDir(current => (current === 'back' ? 'front' : 'back'));
  }

  const classificationContext = Worklets.createContext('classification thread');

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet'

      if (!pickerVisible && currentModel != null && labels.length > 0 && !loading) {

        if (global.__frameBuffer == null) {

          global.__frameBuffer = new Uint8Array(8 * 224 * 224 * 3);
          global.__writeIndex = 0;
        }

        runAtTargetFps(6, () => {

          const resized = resize(frame, {
            scale: {
              width: 224,
              height: 224,
            },
            pixelFormat: 'rgb',
            dataType: 'uint8',
          });

          const offset = global.__writeIndex * 224 * 224 * 3;
          for (let i = 0; i < resized.length; i++) {
            global.__frameBuffer[offset + i] = resized[i];
          }

          global.__writeIndex = (global.__writeIndex + 1) % 8;

          if (global.__writeIndex === 0) {
            classificationContext.runAsync((buffer) => {
              'worklet'
              console.log("Running classification");
              //console.log(global.__frameBuffer);
              const result = currentModel.runSync([buffer])[0];
              const maxEntry = parseInt(Object.entries(result).reduce((max, entry) => {
                return entry[1] > max[1] ? entry : max;
              })[0]);

              const translation_value = labels[maxEntry];
              console.log(translation_value);
              passTranslation(translation_value);
            }, global.__frameBuffer)
          }
        }
        )
      }
    },
    [currentModel, labels, loading]
  );

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />
      {hasPermission && device != null ? (
        <Camera
          device={device}
          style={styles.camera}
          isActive={true}
          frameProcessor={frameProcessor}
          pixelFormat="rgb"
          enableFpsGraph={true}
        />

      ) : (
        <Text>No Camera available:(</Text>
      )}
      <View style={styles.languageButtonContainer}>
        <TouchableOpacity onPress={togglePicker}>
          <FontAwesome6 name="earth-americas" size={25} color="#FFFFFF" iconStyle="solid" />
        </TouchableOpacity>
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.textTranslation}>{translation}</Text>
      </View>
      <View style={styles.cameraButtonContainer}>
        <TouchableOpacity style={styles.cameraButton} onPress={toggleCameraFacing}>
          <FontAwesome6 name="camera-rotate" size={40} color="#FFFFFF" iconStyle="solid" />
        </TouchableOpacity>
      </View>
      <LanguageModelPicker
        visible={pickerVisible}
        models={models}
        selectedModelId={selectedModelId}
        onSelect={async (id) => {
          setSelectedModelId(id);
          setPickerVisible(false);
          const selectedModel = models.find((model) => model.id === id);
          if (selectedModel) {
            await loadModel(selectedModel.name);
          }
        }}
        onClose={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: windowHeight,
    width: windowWidth,
    position: 'relative',
  },
  loader: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  message: {
    textAlign: 'center',
    paddingBottom: 10,
  },
  camera: {
    flex: 1,
    height: windowWidth,
    width: windowWidth,
    padding: 0,
    margin: 0,
  },
  cameraButtonContainer: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    zIndex: 10,
  },
  cameraButton: {
    padding: 10,
    alignItems: 'center',
  },
  languageButtonContainer: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10,
  },
  textContainer: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    bottom: 100,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  textTranslation: {
    color: 'rgb(255,255,255)',
    fontSize: 20,
    textAlign: 'center',
    paddingVertical: 7,
  },
});