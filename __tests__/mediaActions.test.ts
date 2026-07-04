/**
 * T2 (batch stabilitate) — poza trece prin expo-image-manipulator ÎNAINTE de trimitere:
 *  - latura mare plafonată la 1600px (fișier mic → transfer rapid, fără head-of-line);
 *  - RE-ENCODARE JPEG quality 0.7 → tot EXIF-ul (inclusiv GPS) cade = fără scurgere de locație.
 * Modulul nativ e mock-uit; verificăm că `manipulateAsync` e chemat cu acțiunile/opțiunile corecte
 * și că uri-ul rezultat (nu originalul) ajunge în atașament. Plus degradare grațioasă la eroare.
 */
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: uri + "#manip", width: 1600, height: 900 })),
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
}));
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "img", Videos: "vid" },
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-av", () => ({ Audio: {} }));
jest.mock("../src/media/audioMode", () => ({ setPlaybackAudioMode: jest.fn(), setRecordingAudioMode: jest.fn() }));

const ImagePicker = require("expo-image-picker");
const ImageManipulator = require("expo-image-manipulator");
const { pickImage, takePhoto } = require("../src/media/actions");

beforeEach(() => jest.clearAllMocks());

function libraryReturns(asset: any) {
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [asset] });
}

describe("T2 — resize + EXIF strip la poze", () => {
  it("poză mare landscape → resize pe lățime 1600 + JPEG quality 0.7", async () => {
    libraryReturns({ uri: "file://big.jpg", width: 4000, height: 3000 });
    const att = await pickImage();
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file://big.jpg",
      [{ resize: { width: 1600 } }],
      { compress: 0.7, format: "jpeg" },
    );
    expect(att.uri).toBe("file://big.jpg#manip"); // uri-ul procesat, NU originalul
    expect(att.kind).toBe("image");
  });

  it("poză mare portrait → resize pe înălțime 1600", async () => {
    libraryReturns({ uri: "file://tall.jpg", width: 3000, height: 4000 });
    await pickImage();
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file://tall.jpg",
      [{ resize: { height: 1600 } }],
      { compress: 0.7, format: "jpeg" },
    );
  });

  it("poză deja mică → tot re-encodată (actions gol) ca să cadă EXIF-ul", async () => {
    libraryReturns({ uri: "file://small.jpg", width: 800, height: 600 });
    await pickImage();
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file://small.jpg", [], { compress: 0.7, format: "jpeg" },
    );
  });

  it("manipulare eșuată → degradare grațioasă pe originalul dat (tot trimite)", async () => {
    libraryReturns({ uri: "file://orig.jpg", width: 4000, height: 3000 });
    ImageManipulator.manipulateAsync.mockRejectedValueOnce(new Error("decode fail"));
    const att = await pickImage();
    expect(att.uri).toBe("file://orig.jpg"); // cade pe original, nu aruncă
  });

  it("takePhoto trece și el poza prin manipulator (strip EXIF pe camera)", async () => {
    ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file://cam.jpg", width: 4000, height: 2250 }] });
    const att = await takePhoto();
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalled();
    expect(att.uri).toBe("file://cam.jpg#manip");
  });
});
