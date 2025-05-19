import * as React from 'react'
import { Text, View, StyleSheet, TouchableOpacity, Dimensions, ActivityIndicator } from "react-native";
import { useState, useEffect } from 'react';
import {
  Camera,
  useCameraDevice,
  CameraPosition,
  useCameraPermission,
  useFrameProcessor,
  runAtTargetFps,
} from 'react-native-vision-camera'
import {
  Tensor,
  TensorflowModel,
  loadTensorflowModel,
} from 'react-native-fast-tflite'
import { useResizePlugin } from 'vision-camera-resize-plugin'
import FontAwesome6 from '@react-native-vector-icons/fontawesome6';
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core';
import * as FileSystem from 'expo-file-system';
import LanguageModelPicker from './modelPopUp';
import { loadModelList, downloadModelFromSupabase, ensureModelsDir } from './utils/fileUtils';
import { ModelItem } from './modelPopUp';


const windowWidth = Dimensions.get('screen').width;
const windowHeight = Dimensions.get('screen').height;


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

type FullModelItem = ModelItem & {
  id: string;
  name: string;
  language: string;
  downloaded: boolean;
};

export default function Index() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [deviceDir, setDeviceDir] = useState<CameraPosition>('front');
  const device = useCameraDevice(deviceDir);
  const runningInference = useSharedValue<Boolean>(false);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [classificationOn, setClassification] = useState(false);
  const [models, setModels] = useState<FullModelItem[]>([]);
  const [currentModel, setCurrentModel] = useState<TensorflowModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string>('1');

  const { resize } = useResizePlugin()

  const togglePicker = () => setPickerVisible((v) => !v);

  const [translation, setTranslation] = useState('');
  const passTranslation = useRunOnJS((translation) => {
    setTranslation(labels[translation]);
  });


  const [labels, setLabels] = useState<string[]>([]);

  const loadModel = async (modelName: string) => {
    console.log("Загружается модель:", modelName);
    setLoading(true);

    const modelPath = `${FileSystem.documentDirectory}models/${modelName}/model.tflite`;
    const labelsPath = `${FileSystem.documentDirectory}models/${modelName}/labels.txt`;
    const metaPath = `${FileSystem.documentDirectory}models/${modelName}/meta.json`;

    const modelInfo = await FileSystem.getInfoAsync(modelPath);
    const labelInfo = await FileSystem.getInfoAsync(labelsPath);
    const metaInfo = await FileSystem.getInfoAsync(metaPath);
    if (!modelInfo.exists || !labelInfo.exists || !metaInfo.exists) {
      console.log("Загружается модель с сервера: ", modelName)
      await downloadModelFromSupabase(modelName);
    }
    try {
      const model = await loadTensorflowModel({ url: modelPath }, 'android-gpu');
      if (model) {
        setCurrentModel(model);
        console.log(`Модель загружена:\n${modelToString(model)}]`);
      }
      else {
        console.log("Модель не найдена");
        setCurrentModel(null);
      };
    }
    catch (e) {
      console.log("Ошибка при gpu delegate\n", e);
      const model = await loadTensorflowModel({ url: modelPath });
      if (model) {
        setCurrentModel(model);
        console.log(`Модель загружена:\n${modelToString(model)}]`);
      }
      else {
        console.log("Модель не найдена");
        setCurrentModel(null);
      };
    }
    
    
    const labelsContent = await FileSystem.readAsStringAsync(labelsPath);
    setLabels(labelsContent.split('\n'));
    console.log("Метки загружены");
    setLoading(false);
  };

  useEffect(() => {
    async function prepare() {
      try {
        await ensureModelsDir();
        const loadedModels = await loadModelList();
        setModels(loadedModels);
        loadModel("MobileNetV2-TSM-Bukva");
        setSelectedModelId('1');
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

  useEffect(() => {
    if (!pickerVisible && currentModel != null && labels.length > 0 && !loading) {
      setClassification(true)
    }
    else{
      setClassification(false)
    }
  },[pickerVisible, currentModel, labels, loading]
  )

  function rotateImage90Clockwise(originalData:Float32Array, width:number, height:number, channels = 3) {
    'worklet'
    const newWidth = height;
    const newHeight = width;
    const rotatedData = new Float32Array(newWidth * newHeight * channels);
    
    for (let i = 0; i < newWidth * newHeight; i++) {
        const newX = i % newWidth;
        const newY = Math.floor(i / newWidth);
        const originalX = height - 1 - newY;
        const originalY = newX;
        const originalIndex = (originalY * width + originalX) * channels;
        const rotatedIndex = i * channels;
        
        for (let c = 0; c < channels; c++) {
            rotatedData[rotatedIndex + c] = originalData[originalIndex + c];
        }
    }
    
    return rotatedData;
};

  //const inferenceContext = Worklets.createContext('inference-thread');

  const runInference = (frameBuffer:Float32Array) => {
    'worklet'
    
    runningInference.value = true;
    const result = currentModel.runSync([frameBuffer]);
    const maxEntry = Object.entries(result[0]).reduce((max, entry) => {
      return entry[1] > max[1] ? entry : max;
    });
    if (maxEntry[1] > 0.4 && maxEntry[0] != "0") {
      const translation_value = parseInt(maxEntry[0]);
      passTranslation(translation_value);
    }
    runningInference.value = false;
  }


  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet'

      if (classificationOn) {
        if (global.__frameBuffer == null) {

          global.__frameBuffer = new Float32Array(8 * 224 * 224 * 3);
          global.__writeIndex = 0;
        }

        runAtTargetFps(6, () => {

          console.log(frame.orientation);

          const resized = rotateImage90Clockwise(resize(frame, {
            scale: {
              width: 224,
              height: 224,
            },
            pixelFormat: 'rgb',
            dataType: 'float32',
          }), 224, 224, 3);


          const offset = global.__writeIndex * 224 * 224 * 3;
          for (let i = 0; i < resized.length; i++) {
            global.__frameBuffer[offset + i] = resized[i];
          }

          global.__writeIndex = (global.__writeIndex + 1) % 8;

          if (global.__writeIndex === 0) {
            console.log("Запуск классификации");
            runInference(global.__frameBuffer);
            
            // const result = currentModel.runSync([global.__frameBuffer])[0];
            // const maxEntry = Object.entries(result).reduce((max, entry) => {
            //   return entry[1] > max[1] ? entry : max;
            // });
            // if (maxEntry[1] > 0.4) {
            //   const translation_value = parseInt(maxEntry[0]);
            //   passTranslation(translation_value);
            // }
            // else {
            //   passTranslation(0);
            // }

          }
        }
        )
      }
    },
    [classificationOn, currentModel]
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