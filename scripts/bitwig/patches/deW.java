import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;

/**
 * 6.0.6 target-side implementation of the licensed-state fixture used for the
 * authorized Bitwig conference demo. This source is compiled against the
 * official 6.0.6 JAR; no 6.0.1 class bytes are copied into the output.
 */
public class deW {
  public static final byte[] ffA = { -1, -17, -33 };

  public static final deV yay = new deV(
      14,
      true,
      "Bitwig Studio",
      "",
      "standard",
      null,
      "https://www.bitwig.com/studio/?utm_source=app#buy",
      "https://www.bitwig.com/account-profile/?utm_source=app#product",
      4,
      new int[0],
      false,
      false,
      true,
      true,
      true,
      true,
      new int[0],
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      -1,
      true,
      true);

  static {
    int[] empty = new int[0];
    yay.ffA(empty);
    yay.eOi(empty);
    yay.cG3(empty);
    yay.Uhv(empty);
  }

  public deW() {}

  public deR ffA(byte[] activationData) {
    List<deT> products = new ArrayList<>();
    deT product = new deT();
    deU category = new deU();
    category.ffA(11);
    category.ffA("Bitwig Studio");
    category.eOi(11);
    product.ffA(category);
    // Bitwig 6.0.6 renders this value in the activation view as four groups
    // of four characters. The 6.0.1 fixture left it absent because that UI
    // path did not dereference it.
    product.ffA("0000000000000000");
    category.ffA(yay);
    products.add(product);

    dfc supportPlan = new dfc(dfd.eOi, new Date(), new Date(), 0);
    HashMap<Integer, deV> editions = new HashMap<>();
    editions.put(11, yay);

    HashMap<Object, Object> emptyOne = new HashMap<>();
    HashMap<Object, Object> emptyTwo = new HashMap<>();
    return new deR(
        activationData,
        activationData,
        new String(activationData, StandardCharsets.UTF_8),
        ".ORGASM",
        0,
        true,
        products,
        supportPlan,
        new Date(),
        emptyTwo.values(),
        editions,
        emptyOne);
  }
}
