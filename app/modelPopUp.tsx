import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';

export type ModelItem = {
  id: string;
  name: string;
  language: string;
  downloaded: boolean;
};

interface LanguageModelPickerProps {
  visible: boolean;
  models: ModelItem[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  onShow: () => void;
}

const LanguageModelPicker: React.FC<LanguageModelPickerProps> = ({
  visible,
  models,
  selectedModelId,
  onSelect,
  onClose,
  onShow,
}) => {
  const renderItem = ({ item }: { item: ModelItem }) => {
    const isSelected = item.id === selectedModelId;
    return (
      <TouchableOpacity
        style={[
          styles.itemContainer,
          isSelected && styles.selectedItem,
        ]}
        onPress={() => onSelect(item.id)}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{item.language}</Text>
          <Text style={styles.itemSubtitle}>
            {item.name}
          </Text>
        </View>
        {item.downloaded && (
          <Text style={styles.downloadedBadge}>Загружено</Text>
        )}
        {isSelected && <FontAwesome name="check" size={20} color="#007AFF" />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.header}>Выберите модель</Text>
          <FlatList
            data={models}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            extraData={selectedModelId}
          />
          <TouchableOpacity style={styles.closeButton} onPress={onShow}>
            <Text style={styles.ButtonText}>Показать FPS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.ButtonText}>Закрыть</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    elevation: 5,
  },
  header: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  itemContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  selectedItem: {
    backgroundColor: '#e6f0ff',
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  itemSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  downloadedBadge: {
    backgroundColor: '#e0ffe0',
    color: '#006600',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
    fontSize: 12,
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },

  ButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
});

export default LanguageModelPicker;
